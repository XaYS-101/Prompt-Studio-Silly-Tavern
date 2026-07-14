// Studio popup shell: fullscreen dialog with a header (preset name, dirty
// badge, dry-run / update-preset actions), a tab bar and a single body that
// tab modules render into through the `nav` object — tab modules never import
// this one, which keeps the module graph cycle-free.

import { eventSource, event_types } from '../../../../../script.js';
import { Popup, POPUP_TYPE, callGenericPopup } from '../../../../popup.js';
import { t, localize } from './i18n.js';
import { debounce, LOG } from './util.js';
import { getSettings, save } from './state.js';
import { isSelfWrite, currentPresetName, updatePresetFile, caps } from './st-bridge.js';
import { renderPromptsTab } from './ui-prompts.js';
import { renderRegexTab } from './ui-regex.js';
import { renderBlocksTab } from './ui-library.js';
import { renderHistoryTab } from './ui-history.js';
import { renderReferenceTab } from './ui-reference.js';
import { renderDryRunView } from './ui-preview.js';

const toast = () => globalThis.toastr;

const TABS = ['prompts', 'regex', 'blocks', 'history', 'reference'];

let current = null; // { root, body, dlg, tab, params, cleanups, insertTarget }
let dirtyToPreset = false;

export function isOpen() {
    return !!current;
}

function buildRoot() {
    const root = document.createElement('div');
    root.className = 'ps-root';
    root.innerHTML = `
        <div class="ps-header">
            <div class="ps-title" data-ps-i18n="ext_name"></div>
            <div class="ps-preset" title="">
                <span class="ps-muted" data-ps-i18n="preset_label"></span>
                <span class="ps-preset-name"></span>
                <span class="ps-dirty" data-ps-i18n="dirty_badge;[title]dirty_tooltip" style="display:none"></span>
            </div>
            <div class="ps-header-actions">
                <div class="menu_button ps-btn ps-dry-run" data-ps-i18n="[title]dryrun_note"><i class="fa-solid fa-flask"></i> <span data-ps-i18n="btn_dry_run"></span></div>
                <div class="menu_button ps-btn ps-update-preset" data-ps-i18n="[title]dirty_tooltip"><i class="fa-solid fa-floppy-disk"></i> <span data-ps-i18n="btn_update_preset"></span></div>
            </div>
        </div>
        <div class="ps-tabbar">
            ${TABS.map(tab => `<div class="ps-tab" data-tab="${tab}" data-ps-i18n="tab_${tab}"></div>`).join('')}
        </div>
        <div class="ps-body"></div>
    `;
    localize(root);
    return root;
}

function makeNav() {
    return {
        openTab: (tab, params = {}) => showTab(tab, params),
        rerender: () => rerenderNow(),
        markDirty: () => markDirty(),
        setInsertTarget: (textarea) => { if (current) current.insertTarget = textarea; },
        getInsertTarget: () => {
            const el = current?.insertTarget;
            return (el && el.isConnected) ? el : null;
        },
        get root() { return current?.root; },
    };
}

export function markDirty() {
    dirtyToPreset = true;
    updateHeader();
}

function updateHeader() {
    if (!current) return;
    const name = currentPresetName();
    const nameEl = current.root.querySelector('.ps-preset-name');
    nameEl.textContent = name || '—';
    nameEl.title = name;
    current.root.querySelector('.ps-dirty').style.display = dirtyToPreset ? '' : 'none';
}

async function showTab(tab, params = {}) {
    if (!current) return;
    current.tab = tab;
    current.params = params;
    if (TABS.includes(tab)) {
        const s = getSettings();
        if (s.ui.lastTab !== tab) {
            s.ui.lastTab = tab;
            save();
        }
    }
    for (const el of current.root.querySelectorAll('.ps-tab')) {
        el.classList.toggle('ps-tab-active', el.dataset.tab === tab);
    }
    // Fresh body on every render so stale async renders write into detached
    // nodes instead of racing the new view for the same DOM.
    const body = current.body.cloneNode(false);
    current.body.replaceWith(body);
    current.body = body;
    const nav = makeNav();
    try {
        if (tab === 'regex') await renderRegexTab(body, nav);
        else if (tab === 'blocks') await renderBlocksTab(body, nav);
        else if (tab === 'history') await renderHistoryTab(body, nav, params);
        else if (tab === 'reference') await renderReferenceTab(body, nav, params);
        else if (tab === 'dryrun') await renderDryRunView(body, nav);
        else await renderPromptsTab(body, nav, params);
    } catch (err) {
        console.error(LOG, `render tab "${tab}" failed`, err);
        body.textContent = t('toast_error');
    }
}

function rerenderNow() {
    if (current) showTab(current.tab, current.params);
}

const externalChange = debounce(() => {
    if (!current || isSelfWrite()) return;
    // Never yank the DOM out from under an actively typing user; the next
    // external event (or tab switch) will catch the panel up.
    const active = document.activeElement;
    if (active && current.root.contains(active) && active.matches('textarea, input, select')) return;
    updateHeader();
    rerenderNow();
}, 250);

function onPresetChanged() {
    dirtyToPreset = false;
    if (!current) return;
    updateHeader();
    rerenderNow();
}

export async function openStudio(initialTab = null) {
    if (current) return;
    const root = buildRoot();
    const body = root.querySelector('.ps-body');
    const tab = initialTab ?? (TABS.includes(getSettings().ui.lastTab) ? getSettings().ui.lastTab : 'prompts');
    current = { root, body, dlg: null, tab, params: {}, cleanups: [], insertTarget: null };

    for (const el of root.querySelectorAll('.ps-tab')) {
        el.addEventListener('click', () => showTab(el.dataset.tab));
    }
    root.querySelector('.ps-dry-run').addEventListener('click', () => showTab('dryrun'));
    root.querySelector('.ps-update-preset').addEventListener('click', () => {
        if (!hasPresetToUpdate()) {
            toast()?.warning(t('update_preset_missing'));
            return;
        }
        if (updatePresetFile()) {
            dirtyToPreset = false;
            updateHeader();
        } else {
            toast()?.warning(t('update_preset_missing'));
        }
    });

    const on = (ev, handler) => {
        if (!ev) return;
        eventSource.on(ev, handler);
        current.cleanups.push(() => eventSource.removeListener?.(ev, handler));
    };
    on(event_types?.SETTINGS_UPDATED, () => externalChange());
    on(event_types?.CHAT_CHANGED, () => externalChange());
    on(event_types?.OAI_PRESET_CHANGED_AFTER, () => onPresetChanged());
    on(event_types?.PRESET_CHANGED, () => onPresetChanged());

    updateHeader();

    const popupOptions = { okButton: t('close'), wide: true, large: true, allowVerticalScrolling: true };
    let closedPromise;
    try {
        const popup = new Popup(root, POPUP_TYPE.TEXT, '', popupOptions);
        current.dlg = popup.dlg ?? null;
        closedPromise = popup.show();
    } catch (err) {
        console.error(LOG, 'Popup class failed, falling back to callGenericPopup', err);
        closedPromise = callGenericPopup(root, POPUP_TYPE.TEXT ?? 1, '', popupOptions);
    }
    // Tag the dialog so our CSS makes it fullscreen (fallback path attaches it
    // a tick later).
    requestAnimationFrame(() => {
        if (!current) return;
        current.dlg = current.dlg || root.closest('dialog');
        current.dlg?.classList.add('ps-dialog');
    });
    current.dlg?.classList.add('ps-dialog');

    showTab(tab);

    try {
        await closedPromise;
    } finally {
        for (const fn of current?.cleanups ?? []) {
            try { fn(); } catch { /* already gone */ }
        }
        externalChange.cancel();
        current = null;
    }
}

function hasPresetToUpdate() {
    return caps.presetFile || !!document.getElementById('update_oai_preset');
}
