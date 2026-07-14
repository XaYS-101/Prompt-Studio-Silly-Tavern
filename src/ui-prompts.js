// Prompts tab: the ordered prompt list (toggle / reorder / select) on the
// left, the single-prompt editor on the right.

import { callGenericPopup, POPUP_TYPE, Popup } from '../../../../popup.js';
import { t, localize } from './i18n.js';
import { LOG, escapeHtml, hashContent } from './util.js';
import {
    pmReady, isCC, listOrderedPrompts, listUnusedPrompts, activeCharacter,
    setPromptEnabled, movePrompt, createPrompt, attachPrompt, perms,
    oaiSettings, countTokens, caps,
} from './st-bridge.js';
import { renderEditor } from './ui-editor.js';

const toast = () => globalThis.toastr;

let selectedId = null;
const tokenCache = new Map(); // hash -> count

export async function renderPromptsTab(body, nav, params = {}) {
    if (params.select) selectedId = params.select;

    if (!isCC()) {
        body.innerHTML = `<div class="ps-note ps-note-warn" data-ps-i18n="cc_only_notice"></div>`;
        localize(body);
        return;
    }
    if (!pmReady()) {
        body.innerHTML = `<div class="ps-note ps-note-warn" data-ps-i18n="pm_not_ready"></div>`;
        localize(body);
        return;
    }

    body.innerHTML = `
        <div class="ps-prompts">
            <div class="ps-plist">
                <div class="ps-plist-toolbar">
                    <div class="menu_button ps-btn ps-new-prompt"><i class="fa-solid fa-plus"></i> <span data-ps-i18n="btn_new_prompt"></span></div>
                    <div class="menu_button ps-btn ps-attach-prompt"><i class="fa-solid fa-link"></i> <span data-ps-i18n="btn_attach_existing"></span></div>
                </div>
                <div class="ps-plist-note"></div>
                <div class="ps-plist-items"></div>
            </div>
            <div class="ps-editor-host"></div>
        </div>
    `;
    localize(body);

    const items = body.querySelector('.ps-plist-items');
    const editorHost = body.querySelector('.ps-editor-host');
    const orderLocked = !activeCharacter();
    if (orderLocked) {
        const note = body.querySelector('.ps-plist-note');
        note.className = 'ps-note ps-note-warn';
        note.setAttribute('data-ps-i18n', 'order_locked');
        localize(note);
    }

    // Extended nav for the editor: lets it refresh list rows (names, tokens)
    // without a full tab rebuild that would drop the caret.
    const editorNav = {
        ...nav,
        refreshList: () => refreshListMeta(items),
    };

    const openEditor = (identifier) => {
        selectedId = identifier;
        for (const row of items.querySelectorAll('.ps-prow')) {
            row.classList.toggle('ps-prow-selected', row.dataset.identifier === identifier);
        }
        try {
            renderEditor(editorHost, identifier, editorNav);
        } catch (err) {
            console.error(LOG, 'editor render failed', err);
            editorHost.textContent = t('toast_error');
        }
    };

    renderList(items, nav, { orderLocked, openEditor });

    body.querySelector('.ps-new-prompt').addEventListener('click', async () => {
        const name = await callGenericPopup(t('new_prompt_title'), POPUP_TYPE.INPUT ?? 3, '');
        if (!name || typeof name !== 'string') return;
        if (!name.trim()) {
            toast()?.warning(t('name_required'));
            return;
        }
        const identifier = await createPrompt({ name: name.trim() });
        if (identifier) {
            selectedId = identifier;
            nav.markDirty();
            nav.rerender();
        }
    });

    body.querySelector('.ps-attach-prompt').addEventListener('click', async () => {
        const unused = listUnusedPrompts();
        if (!unused.length) {
            toast()?.info(t('prompts_empty'));
            return;
        }
        const content = document.createElement('div');
        content.className = 'ps-attach-list';
        content.innerHTML = `<h4 data-ps-i18n="attach_pick_title"></h4>`
            + unused.map(p => `
                <div class="menu_button ps-btn ps-attach-row" data-identifier="${escapeHtml(p.identifier)}">
                    <span class="ps-badge">${escapeHtml(roleShort(p.role))}</span>
                    <span>${escapeHtml(p.name || p.identifier)}</span>
                </div>`).join('');
        localize(content);
        let popup = null;
        content.addEventListener('click', async (event) => {
            const row = event.target.closest('.ps-attach-row');
            if (!row) return;
            const identifier = row.dataset.identifier;
            popup?.completeCancelled?.() ?? popup?.dlg?.close?.();
            await attachPrompt(identifier);
            selectedId = identifier;
            nav.markDirty();
            nav.rerender();
        });
        try {
            popup = new Popup(content, POPUP_TYPE.TEXT, '', { okButton: t('cancel'), allowVerticalScrolling: true });
            await popup.show();
        } catch (err) {
            console.error(LOG, 'attach popup failed', err);
            await callGenericPopup(content, POPUP_TYPE.TEXT ?? 1, '', { okButton: t('cancel'), allowVerticalScrolling: true });
        }
    });

    if (selectedId) openEditor(selectedId);
    else {
        editorHost.innerHTML = `<div class="ps-empty" data-ps-i18n="select_prompt_hint"></div>`;
        localize(editorHost);
    }
}

function roleShort(role) {
    if (role === 'user') return 'U';
    if (role === 'assistant') return 'A';
    return 'S';
}

function renderList(items, nav, { orderLocked, openEditor }) {
    items.textContent = '';
    const entries = orderLocked
        ? (oaiSettings()?.prompts ?? []).filter(p => p && !p.marker).map(prompt => ({ prompt, enabled: null }))
        : listOrderedPrompts();

    if (!entries.length) {
        items.innerHTML = `<div class="ps-empty" data-ps-i18n="prompts_empty"></div>`;
        localize(items);
        return;
    }

    for (const { prompt, enabled } of entries) {
        const row = document.createElement('div');
        row.className = 'ps-prow';
        row.dataset.identifier = prompt.identifier;
        if (prompt.identifier === getSelectedId()) row.classList.add('ps-prow-selected');
        if (enabled === false) row.classList.add('ps-prow-disabled');

        const canToggle = !orderLocked && perms.canToggle(prompt);
        row.innerHTML = `
            ${orderLocked ? '' : `<input type="checkbox" class="ps-prow-toggle" data-ps-i18n="[title]toggle_title" ${enabled ? 'checked' : ''} ${canToggle ? '' : 'disabled'}>`}
            <div class="ps-prow-main">
                <span class="ps-prow-name">${escapeHtml(prompt.name || prompt.identifier)}</span>
                <span class="ps-badge">${escapeHtml(roleShort(prompt.role))}</span>
                ${prompt.marker ? `<span class="ps-badge ps-badge-marker" data-ps-i18n="marker_badge"></span>` : ''}
            </div>
            <span class="ps-prow-tokens ps-muted" data-hash=""></span>
            ${orderLocked ? '' : `
            <div class="ps-prow-move">
                <div class="ps-move-btn ps-move-up" data-ps-i18n="[title]move_up"><i class="fa-solid fa-chevron-up"></i></div>
                <div class="ps-move-btn ps-move-down" data-ps-i18n="[title]move_down"><i class="fa-solid fa-chevron-down"></i></div>
            </div>`}
        `;
        localize(row);

        row.querySelector('.ps-prow-main').addEventListener('click', () => openEditor(prompt.identifier));
        row.querySelector('.ps-prow-toggle')?.addEventListener('change', async (event) => {
            await setPromptEnabled(prompt.identifier, event.target.checked);
            row.classList.toggle('ps-prow-disabled', !event.target.checked);
            nav.markDirty();
        });
        row.querySelector('.ps-move-up')?.addEventListener('click', async () => {
            if (await movePrompt(prompt.identifier, -1)) {
                nav.markDirty();
                if (row.previousElementSibling) items.insertBefore(row, row.previousElementSibling);
            }
        });
        row.querySelector('.ps-move-down')?.addEventListener('click', async () => {
            if (await movePrompt(prompt.identifier, +1)) {
                nav.markDirty();
                if (row.nextElementSibling) items.insertBefore(row.nextElementSibling, row);
            }
        });

        items.appendChild(row);
    }

    refreshListMeta(items);
}

/** Refresh names and async token counts in place (no rebuild). */
async function refreshListMeta(items) {
    if (!items?.isConnected) return;
    const prompts = new Map((oaiSettings()?.prompts ?? []).filter(Boolean).map(p => [p.identifier, p]));
    for (const row of items.querySelectorAll('.ps-prow')) {
        const prompt = prompts.get(row.dataset.identifier);
        if (!prompt) continue;
        const nameEl = row.querySelector('.ps-prow-name');
        const name = prompt.name || prompt.identifier;
        if (nameEl.textContent !== name) nameEl.textContent = name;
    }
    if (!caps.tokens) return;
    for (const row of items.querySelectorAll('.ps-prow')) {
        const prompt = prompts.get(row.dataset.identifier);
        if (!prompt || prompt.marker || !prompt.content) continue;
        const tokensEl = row.querySelector('.ps-prow-tokens');
        const hash = hashContent(prompt.content);
        if (tokensEl.dataset.hash === hash) continue;
        let n = tokenCache.get(hash);
        if (n === undefined) {
            n = await countTokens(prompt.content);
            if (n === null) continue;
            if (tokenCache.size > 500) tokenCache.clear();
            tokenCache.set(hash, n);
        }
        if (!row.isConnected) return;
        tokensEl.dataset.hash = hash;
        tokensEl.textContent = t('tokens_label', { n });
    }
}

function getSelectedId() {
    return selectedId;
}
