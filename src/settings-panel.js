// Extensions-panel drawer: language, open-studio button, editor toggles,
// history limits with a storage indicator, export/import of the extension's
// own data, and the clear-all danger button.

import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';
import { t, localize } from './i18n.js';
import { LOG, jsonKb } from './util.js';
import {
    getSettings, save, resetAllData, buildExportPayload, applyImportPayload,
    pruneSnapshots, countSnapshots,
} from './state.js';
import { openStudio } from './ui-popup.js';

const toast = () => globalThis.toastr;

const PANEL_HTML = `
<div id="ps_settings" class="ps-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Prompt Studio</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="ps-set-row">
                <label for="ps_language" data-ps-i18n="language"></label>
                <select id="ps_language" class="text_pole">
                    <option value="auto" data-ps-i18n="lang_auto"></option>
                    <option value="en">English</option>
                    <option value="ru">Русский</option>
                </select>
            </div>
            <div class="ps-set-row">
                <div id="ps_open_studio" class="menu_button ps-open-btn">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span data-ps-i18n="open_studio"></span>
                </div>
            </div>
            <label class="checkbox_label">
                <input id="ps_opt_autocomplete" type="checkbox">
                <span data-ps-i18n="opt_autocomplete"></span>
            </label>
            <label class="checkbox_label">
                <input id="ps_opt_highlight" type="checkbox">
                <span data-ps-i18n="opt_highlight"></span>
            </label>
            <label class="checkbox_label">
                <input id="ps_opt_live_preview" type="checkbox">
                <span data-ps-i18n="opt_live_preview"></span>
            </label>
            <label class="checkbox_label">
                <input id="ps_opt_auto_snapshot" type="checkbox">
                <span data-ps-i18n="opt_auto_snapshot"></span>
            </label>
            <label class="checkbox_label">
                <input id="ps_opt_confirm_restore" type="checkbox">
                <span data-ps-i18n="opt_confirm_restore"></span>
            </label>
            <hr>
            <div class="ps-set-block">
                <b data-ps-i18n="caps_title"></b>
                <div class="ps-set-row">
                    <label for="ps_cap_per_prompt" data-ps-i18n="cap_per_prompt"></label>
                    <input id="ps_cap_per_prompt" class="text_pole ps-cap-input" type="number" min="1" max="200">
                </div>
                <div class="ps-set-row">
                    <label for="ps_cap_total" data-ps-i18n="cap_total"></label>
                    <input id="ps_cap_total" class="text_pole ps-cap-input" type="number" min="10" max="5000">
                </div>
                <div class="ps-set-row">
                    <label for="ps_cap_max_chars" data-ps-i18n="cap_max_chars"></label>
                    <input id="ps_cap_max_chars" class="text_pole ps-cap-input" type="number" min="1000" max="500000">
                </div>
                <div class="ps-set-row">
                    <small class="ps-muted ps-storage-usage"></small>
                    <div id="ps_prune" class="menu_button"><i class="fa-solid fa-broom"></i> <span data-ps-i18n="prune_btn"></span></div>
                </div>
            </div>
            <hr>
            <div class="ps-set-row">
                <div id="ps_export" class="menu_button"><i class="fa-solid fa-file-export"></i> <span data-ps-i18n="export_btn"></span></div>
                <div id="ps_import" class="menu_button"><i class="fa-solid fa-file-import"></i> <span data-ps-i18n="import_btn"></span></div>
                <input id="ps_import_file" type="file" accept=".json" hidden>
            </div>
            <hr>
            <div class="ps-set-row">
                <div id="ps_clear_all" class="menu_button ps-danger"><i class="fa-solid fa-triangle-exclamation"></i> <span data-ps-i18n="clear_all_btn"></span></div>
            </div>
        </div>
    </div>
</div>`;

function updateStorageLine(panel) {
    const s = getSettings();
    const usage = panel.querySelector('.ps-storage-usage');
    usage.textContent = t('storage_usage', {
        kb: jsonKb({ snapshots: s.snapshots, blocks: s.blocks }),
        n: countSnapshots(),
    });
}

function syncControls(panel) {
    const s = getSettings();
    panel.querySelector('#ps_language').value = s.language;
    panel.querySelector('#ps_opt_autocomplete').checked = !!s.ui.autocomplete;
    panel.querySelector('#ps_opt_highlight').checked = !!s.ui.highlight;
    panel.querySelector('#ps_opt_live_preview').checked = !!s.ui.livePreview;
    panel.querySelector('#ps_opt_auto_snapshot').checked = !!s.ui.autoSnapshot;
    panel.querySelector('#ps_opt_confirm_restore').checked = !!s.confirmRestore;
    panel.querySelector('#ps_cap_per_prompt').value = s.snapshotCaps.perPrompt;
    panel.querySelector('#ps_cap_total').value = s.snapshotCaps.totalEntries;
    panel.querySelector('#ps_cap_max_chars').value = s.snapshotCaps.maxContentChars;
    updateStorageLine(panel);
}

function exportData() {
    const blob = new Blob([JSON.stringify(buildExportPayload(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'prompt-studio-data.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

async function importData(event, panel) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        applyImportPayload(data);
        syncControls(panel);
        toast()?.success(t('import_ok'));
    } catch (err) {
        console.error(LOG, 'import failed', err);
        toast()?.error(t('import_bad'));
    }
}

async function clearAll(panel) {
    const ok = await callGenericPopup(t('confirm_clear_all'), POPUP_TYPE.CONFIRM ?? 2);
    if (ok !== (POPUP_RESULT?.AFFIRMATIVE ?? 1)) return;
    resetAllData();
    syncControls(panel);
    localize(panel);
    toast()?.success(t('clear_done'));
}

export function mountSettingsPanel() {
    const host = document.getElementById('extensions_settings2')
        ?? document.getElementById('extensions_settings')
        ?? document.body;
    const wrap = document.createElement('div');
    wrap.innerHTML = PANEL_HTML;
    const panel = wrap.firstElementChild;
    localize(panel);
    syncControls(panel);
    host.appendChild(panel);

    panel.querySelector('#ps_language').addEventListener('change', (e) => {
        const s = getSettings();
        s.language = ['en', 'ru', 'auto'].includes(e.target.value) ? e.target.value : 'ru';
        save();
        localize(panel);
        updateStorageLine(panel);
    });
    panel.querySelector('#ps_open_studio').addEventListener('click', () => openStudio());

    const bindToggle = (id, apply) => {
        panel.querySelector(id).addEventListener('change', (e) => {
            apply(getSettings(), !!e.target.checked);
            save();
        });
    };
    bindToggle('#ps_opt_autocomplete', (s, v) => { s.ui.autocomplete = v; });
    bindToggle('#ps_opt_highlight', (s, v) => { s.ui.highlight = v; });
    bindToggle('#ps_opt_live_preview', (s, v) => { s.ui.livePreview = v; });
    bindToggle('#ps_opt_auto_snapshot', (s, v) => { s.ui.autoSnapshot = v; });
    bindToggle('#ps_opt_confirm_restore', (s, v) => { s.confirmRestore = v; });

    const bindCap = (id, key, min, max) => {
        panel.querySelector(id).addEventListener('change', (e) => {
            const s = getSettings();
            const value = Math.max(min, Math.min(max, Number(e.target.value) || s.snapshotCaps[key]));
            s.snapshotCaps[key] = value;
            e.target.value = value;
            pruneSnapshots();
            save();
            updateStorageLine(panel);
        });
    };
    bindCap('#ps_cap_per_prompt', 'perPrompt', 1, 200);
    bindCap('#ps_cap_total', 'totalEntries', 10, 5000);
    bindCap('#ps_cap_max_chars', 'maxContentChars', 1000, 500000);

    panel.querySelector('#ps_prune').addEventListener('click', () => {
        pruneSnapshots();
        save();
        updateStorageLine(panel);
        toast()?.success(t('prune_done'));
    });

    panel.querySelector('#ps_export').addEventListener('click', exportData);
    panel.querySelector('#ps_import').addEventListener('click', () => panel.querySelector('#ps_import_file').click());
    panel.querySelector('#ps_import_file').addEventListener('change', (e) => importData(e, panel));
    panel.querySelector('#ps_clear_all').addEventListener('click', () => clearAll(panel));
}
