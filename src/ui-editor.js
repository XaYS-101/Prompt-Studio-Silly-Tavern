// Single-prompt editor: fields, content textarea with macro autocomplete and
// a highlight backdrop (a mirror div behind a normal textarea — the textarea
// stays the source of truth, which autocomplete and IME need), plus the live
// preview block. Saves apply to oai_settings (debounced); the preset file is
// only written by the header button.

import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';
import { t, localize } from './i18n.js';
import { LOG, escapeHtml, debounce, insertAtCursor } from './util.js';
import { getSettings, addSnapshot, listBlocks, addBlock } from './state.js';
import {
    getPromptById, applyPromptPatch, detachPrompt, deletePrompt, perms,
    attachAutocomplete, getAllMacros, currentPresetName, injectionPosition, caps,
    countTokens,
} from './st-bridge.js';
import { renderInlinePreview } from './ui-preview.js';

const toast = () => globalThis.toastr;

const TRIGGERS = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'];
const VAR_MACROS = new Set([
    'var', 'getvar', 'setvar', 'addvar', 'incvar', 'decvar',
    'getglobalvar', 'setglobalvar', 'addglobalvar', 'incglobalvar', 'decglobalvar',
]);

let knownMacroNames = null;
function getKnownMacroNames() {
    if (knownMacroNames) return knownMacroNames;
    const names = new Set();
    for (const def of getAllMacros()) {
        if (def?.name) names.add(String(def.name).toLowerCase());
        for (const alias of def?.aliases ?? []) {
            const aliasName = typeof alias === 'string' ? alias : (alias?.alias ?? alias?.name);
            if (aliasName) names.add(String(aliasName).toLowerCase());
        }
    }
    knownMacroNames = names;
    return names;
}

function highlightHtml(text) {
    const known = getKnownMacroNames();
    let html = '';
    let last = 0;
    const re = /{{[^{}]*}}/g;
    let match;
    while ((match = re.exec(text)) !== null) {
        html += escapeHtml(text.slice(last, match.index));
        const token = match[0];
        const inner = token.slice(2, -2).trim();
        const name = inner.split(/[:\s]/)[0].replace(/^[!#?~]/, '').toLowerCase();
        let cls = 'ps-macro';
        if (inner.startsWith('//')) cls += ' ps-macro-comment';
        else if (VAR_MACROS.has(name)) cls += ' ps-macro-var';
        else if (known.size && !known.has(name)) cls += ' ps-macro-unknown';
        html += `<mark class="${cls}">${escapeHtml(token)}</mark>`;
        last = match.index + token.length;
    }
    html += escapeHtml(text.slice(last));
    // Trailing newline needs a visible placeholder so backdrop height matches.
    return html + '\n';
}

/**
 * Render the editor for one prompt into `host`.
 * @param {HTMLElement} host
 * @param {string} identifier
 * @param {object} nav - shell nav (markDirty, openTab, setInsertTarget, rerender)
 */
export function renderEditor(host, identifier, nav) {
    host._psCleanup?.();
    host._psCleanup = null;
    host.textContent = '';
    const prompt = getPromptById(identifier);
    if (!prompt) {
        host.innerHTML = `<div class="ps-empty" data-ps-i18n="select_prompt_hint"></div>`;
        localize(host);
        return;
    }
    const s = getSettings();
    const editable = perms.canEdit(prompt);
    const INJECTION = injectionPosition();

    const wrap = document.createElement('div');
    wrap.className = 'ps-editor';

    if (!editable) {
        wrap.innerHTML = `
            <div class="ps-ed-top">
                <div class="ps-ed-title">${escapeHtml(prompt.name || prompt.identifier)} <span class="ps-badge ps-badge-marker" data-ps-i18n="marker_badge"></span></div>
            </div>
            <div class="ps-note" data-ps-i18n="marker_readonly_note"></div>
        `;
        localize(wrap);
        host.appendChild(wrap);
        return;
    }

    const isMarker = !!prompt.marker;
    const roleOptions = ['system', 'user', 'assistant']
        .map(role => `<option value="${role}" ${prompt.role === role ? 'selected' : ''} data-ps-i18n="role_${role}"></option>`)
        .join('');
    const triggerOptions = TRIGGERS
        .map(trig => `<option value="${trig}" ${Array.isArray(prompt.injection_trigger) && prompt.injection_trigger.includes(trig) ? 'selected' : ''} data-ps-i18n="trig_${trig}"></option>`)
        .join('');

    wrap.innerHTML = `
        <div class="ps-ed-top">
            <input type="text" class="text_pole ps-ed-name" data-ps-i18n="[placeholder]prompt_name" value="${escapeHtml(prompt.name ?? '')}">
            <select class="text_pole ps-ed-role">${roleOptions}</select>
        </div>
        <div class="ps-ed-actions">
            <div class="menu_button ps-btn ps-act-snapshot"><i class="fa-solid fa-camera"></i> <span data-ps-i18n="btn_snapshot_now"></span></div>
            <div class="menu_button ps-btn ps-act-history"><i class="fa-solid fa-clock-rotate-left"></i> <span data-ps-i18n="btn_history_of_prompt"></span></div>
            <div class="menu_button ps-btn ps-act-block-sel"><i class="fa-solid fa-cubes"></i> <span data-ps-i18n="btn_block_from_selection"></span></div>
            <select class="text_pole ps-block-select"></select>
            <div class="ps-ed-actions-spacer"></div>
            <div class="menu_button ps-btn ps-act-detach" data-ps-i18n="[title]detach_action"><i class="fa-solid fa-chain-broken"></i></div>
            <div class="menu_button ps-btn ps-danger ps-act-delete" data-ps-i18n="[title]delete_action"><i class="fa-solid fa-trash"></i></div>
        </div>
        ${isMarker ? '' : `
        <div class="ps-ed-fields">
            <label class="ps-fld">
                <span data-ps-i18n="fld_position"></span>
                <select class="text_pole ps-ed-position">
                    <option value="${INJECTION.RELATIVE}" ${Number(prompt.injection_position) !== INJECTION.ABSOLUTE ? 'selected' : ''} data-ps-i18n="position_relative"></option>
                    <option value="${INJECTION.ABSOLUTE}" ${Number(prompt.injection_position) === INJECTION.ABSOLUTE ? 'selected' : ''} data-ps-i18n="position_absolute"></option>
                </select>
            </label>
            <label class="ps-fld ps-fld-depth">
                <span data-ps-i18n="fld_depth"></span>
                <input type="number" class="text_pole ps-ed-depth" min="0" max="9999" value="${Number(prompt.injection_depth ?? 4)}">
            </label>
            <label class="ps-fld ps-fld-order">
                <span data-ps-i18n="fld_order"></span>
                <input type="number" class="text_pole ps-ed-order" min="0" max="9999" value="${Number(prompt.injection_order ?? 100)}">
            </label>
            <label class="ps-fld">
                <span data-ps-i18n="fld_triggers"></span>
                <select class="text_pole ps-ed-triggers" multiple>${triggerOptions}</select>
            </label>
            <label class="checkbox_label ps-fld-forbid">
                <input type="checkbox" class="ps-ed-forbid" ${prompt.forbid_overrides ? 'checked' : ''}>
                <span data-ps-i18n="fld_forbid_overrides"></span>
            </label>
        </div>`}
        <div class="ps-ed-content-head">
            <span data-ps-i18n="content_label"></span>
            <span class="ps-ed-tokens ps-muted"></span>
        </div>
        <div class="ps-edwrap">
            <div class="ps-hl-backdrop" aria-hidden="true"><div class="ps-hl-inner"></div></div>
            <textarea class="ps-ed-textarea" spellcheck="false"></textarea>
        </div>
        <div class="ps-preview-host"></div>
    `;
    localize(wrap);
    host.appendChild(wrap);

    const textarea = wrap.querySelector('.ps-ed-textarea');
    textarea.value = String(prompt.content ?? '');
    const backdrop = wrap.querySelector('.ps-hl-backdrop');
    const backdropInner = wrap.querySelector('.ps-hl-inner');
    const tokensEl = wrap.querySelector('.ps-ed-tokens');

    // --- highlight overlay ---
    const highlightOn = !!s.ui.highlight;
    if (!highlightOn) backdrop.style.display = 'none';
    // The mirror must wrap at exactly the textarea's content width — a visible
    // scrollbar shrinks clientWidth, so the width is synced, not assumed.
    const syncMetrics = () => {
        if (!highlightOn) return;
        const width = textarea.clientWidth;
        if (width > 0) backdropInner.style.width = `${width}px`;
    };
    const renderHighlight = () => {
        if (!highlightOn) return;
        try {
            syncMetrics();
            backdropInner.innerHTML = highlightHtml(textarea.value);
        } catch (err) {
            console.error(LOG, 'highlight failed', err);
            backdrop.style.display = 'none';
        }
    };
    const syncScroll = () => {
        backdropInner.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    };
    textarea.addEventListener('scroll', syncScroll);
    if (highlightOn && typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => {
            syncMetrics();
            syncScroll();
        });
        observer.observe(textarea);
        host._psCleanup = () => observer.disconnect();
    }
    renderHighlight();

    // --- autocomplete ---
    if (s.ui.autocomplete) attachAutocomplete(textarea);
    nav.setInsertTarget(textarea);
    textarea.addEventListener('focus', () => nav.setInsertTarget(textarea));

    // --- token count ---
    const updateTokens = debounce(async () => {
        if (!caps.tokens) return;
        tokensEl.textContent = t('tokens_counting');
        const n = await countTokens(textarea.value);
        tokensEl.textContent = n !== null ? t('tokens_label', { n }) : '';
    }, 600);
    updateTokens();

    // --- live preview ---
    let preview = null;
    if (s.ui.livePreview && caps.substitute) {
        preview = renderInlinePreview(wrap.querySelector('.ps-preview-host'), () => textarea.value);
    }

    // --- saving ---
    const baseline = {
        name: String(prompt.name ?? ''),
        role: String(prompt.role ?? 'system'),
        content: String(prompt.content ?? ''),
    };
    let snapshotArmed = true;
    const ensureSessionSnapshot = () => {
        if (!snapshotArmed) return;
        snapshotArmed = false;
        if (!getSettings().ui.autoSnapshot) return;
        try {
            addSnapshot(currentPresetName(), identifier, baseline);
        } catch (err) {
            console.error(LOG, 'auto snapshot failed', err);
        }
    };

    const collectPatch = () => {
        const patch = {
            name: wrap.querySelector('.ps-ed-name').value,
            role: wrap.querySelector('.ps-ed-role').value,
            content: textarea.value,
        };
        if (!isMarker) {
            const positionEl = wrap.querySelector('.ps-ed-position');
            if (positionEl) {
                patch.injection_position = Number(positionEl.value);
                patch.injection_depth = Number(wrap.querySelector('.ps-ed-depth').value) || 0;
                patch.injection_order = Number(wrap.querySelector('.ps-ed-order').value) || 0;
                patch.injection_trigger = Array.from(wrap.querySelector('.ps-ed-triggers').selectedOptions).map(o => o.value);
                patch.forbid_overrides = wrap.querySelector('.ps-ed-forbid').checked;
            }
        }
        return patch;
    };

    const applyEdit = debounce(async () => {
        try {
            ensureSessionSnapshot();
            await applyPromptPatch(identifier, collectPatch());
            nav.markDirty();
            nav.refreshList?.();
        } catch (err) {
            console.error(LOG, 'apply edit failed', err);
            toast()?.error(t('toast_error'));
        }
    }, 400);

    textarea.addEventListener('input', () => {
        renderHighlight();
        syncScroll();
        updateTokens();
        preview?.update();
        applyEdit();
    });
    for (const el of wrap.querySelectorAll('.ps-ed-name, .ps-ed-role, .ps-ed-position, .ps-ed-depth, .ps-ed-order, .ps-ed-triggers, .ps-ed-forbid')) {
        el.addEventListener('change', () => {
            toggleDepthFields();
            applyEdit();
        });
    }

    const toggleDepthFields = () => {
        const positionEl = wrap.querySelector('.ps-ed-position');
        if (!positionEl) return;
        const absolute = Number(positionEl.value) === INJECTION.ABSOLUTE;
        wrap.querySelector('.ps-fld-depth').style.display = absolute ? '' : 'none';
        wrap.querySelector('.ps-fld-order').style.display = absolute ? '' : 'none';
    };
    toggleDepthFields();

    // --- action buttons ---
    wrap.querySelector('.ps-act-snapshot').addEventListener('click', async () => {
        const note = await callGenericPopup(t('snapshot_note_prompt'), POPUP_TYPE.INPUT ?? 3, '');
        if (note === null || note === POPUP_RESULT?.CANCELLED) return;
        const live = getPromptById(identifier);
        const entry = addSnapshot(currentPresetName(), identifier, {
            name: live?.name, role: live?.role, content: live?.content,
            note: typeof note === 'string' ? note : '',
        });
        toast()?.[entry ? 'success' : 'info'](t(entry ? 'snapshot_taken' : 'snapshot_deduped'));
    });

    wrap.querySelector('.ps-act-history').addEventListener('click', () => {
        nav.openTab('history', { identifier });
    });

    wrap.querySelector('.ps-act-block-sel').addEventListener('click', async () => {
        const start = textarea.selectionStart ?? 0;
        const end = textarea.selectionEnd ?? 0;
        if (end <= start) {
            toast()?.warning(t('block_need_selection'));
            return;
        }
        const selection = textarea.value.slice(start, end);
        const name = await callGenericPopup(t('block_name'), POPUP_TYPE.INPUT ?? 3, '');
        if (!name || typeof name !== 'string') return;
        addBlock(name, selection);
        fillBlockSelect();
        toast()?.success(t('block_created'));
    });

    const blockSelect = wrap.querySelector('.ps-block-select');
    const fillBlockSelect = () => {
        const blocks = listBlocks();
        blockSelect.innerHTML = `<option value="">${escapeHtml(t('btn_insert_block'))}</option>`
            + blocks.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name || b.id)}</option>`).join('');
        blockSelect.disabled = blocks.length === 0;
    };
    fillBlockSelect();
    blockSelect.addEventListener('change', () => {
        const block = listBlocks().find(b => b.id === blockSelect.value);
        blockSelect.value = '';
        if (!block) return;
        insertAtCursor(textarea, block.content);
        toast()?.success(t('block_inserted'));
    });

    wrap.querySelector('.ps-act-detach').addEventListener('click', async () => {
        const ok = await callGenericPopup(t('confirm_detach_prompt'), POPUP_TYPE.CONFIRM ?? 2);
        if (ok !== (POPUP_RESULT?.AFFIRMATIVE ?? 1)) return;
        applyEdit.cancel();
        await detachPrompt(identifier);
        nav.markDirty();
        nav.rerender();
    });

    const deleteButton = wrap.querySelector('.ps-act-delete');
    if (!perms.canDelete(prompt)) deleteButton.style.display = 'none';
    deleteButton.addEventListener('click', async () => {
        const ok = await callGenericPopup(t('confirm_delete_prompt'), POPUP_TYPE.CONFIRM ?? 2);
        if (ok !== (POPUP_RESULT?.AFFIRMATIVE ?? 1)) return;
        applyEdit.cancel();
        const live = getPromptById(identifier);
        if (getSettings().ui.autoSnapshot && live) {
            addSnapshot(currentPresetName(), identifier, { name: live.name, role: live.role, content: live.content, note: 'pre-delete' });
        }
        await deletePrompt(identifier);
        nav.markDirty();
        nav.rerender();
    });
}
