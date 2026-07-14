// Compare tab: the active preset side by side with any other Chat Completion
// preset. Left column edits the live preset through the Prompt Manager (same
// path as the Prompts tab); right column edits a deep clone of the second
// preset and writes it straight into its preset file (debounced, never the
// active one). Per-prompt status badges, copy in both directions, inline diff.

import { t, localize } from './i18n.js';
import { LOG, escapeHtml, debounce } from './util.js';
import {
    isCC, pmReady, oaiSettings, currentPresetName, getPromptById,
    applyPromptPatch, perms, caps, listPresetNames, readPresetByName,
    savePresetByName,
} from './st-bridge.js';
import { renderDiff } from './ui-diff.js';

const toast = () => globalThis.toastr;

let comparedName = null; // picked second preset, survives tab re-renders
let expandedId = null;   // identifier of the expanded prompt row
let searchValue = '';

export async function renderCompareTab(body, nav) {
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
    if (!caps.presets) {
        body.innerHTML = `<div class="ps-note ps-note-warn" data-ps-i18n="cmp_unavailable"></div>`;
        localize(body);
        return;
    }

    const active = currentPresetName();
    const others = listPresetNames().filter(name => name !== active);

    body.innerHTML = `
        <div class="ps-cmp">
            <div class="ps-cmp-toolbar">
                <b class="ps-cmp-activename" title="${escapeHtml(active)}">${escapeHtml(t('cmp_active', { name: active || '—' }))}</b>
                <i class="fa-solid fa-left-right ps-muted"></i>
                <select class="text_pole ps-cmp-pick">
                    ${others.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
                </select>
                <input type="search" class="text_pole ps-cmp-search" data-ps-i18n="[placeholder]cmp_search">
                <span class="ps-muted ps-cmp-status"></span>
            </div>
            <div class="ps-note" data-ps-i18n="cmp_note"></div>
            <div class="ps-cmp-list"></div>
        </div>
    `;
    localize(body);
    const listHost = body.querySelector('.ps-cmp-list');

    if (!others.length) {
        listHost.innerHTML = `<div class="ps-empty" data-ps-i18n="cmp_no_others"></div>`;
        localize(listHost);
        return;
    }

    const pick = body.querySelector('.ps-cmp-pick');
    if (!others.includes(comparedName)) comparedName = others[0];
    pick.value = comparedName;
    const searchEl = body.querySelector('.ps-cmp-search');
    searchEl.value = searchValue;
    const statusEl = body.querySelector('.ps-cmp-status');

    let bData = readPresetByName(comparedName);
    let bDirty = false;

    const saveB = debounce(async () => {
        if (!bData || !bDirty) return;
        bDirty = false;
        const ok = await savePresetByName(comparedName, bData);
        if (ok) {
            statusEl.textContent = t('cmp_saved');
            setTimeout(() => { if (statusEl.isConnected && !bDirty) statusEl.textContent = ''; }, 2500);
        } else {
            bDirty = true;
            toast()?.error(t('toast_error'));
        }
    }, 800);
    const markBDirty = () => {
        bDirty = true;
        statusEl.textContent = '…';
        saveB();
    };

    const buildRows = () => {
        const aList = (oaiSettings()?.prompts ?? []).filter(p => p && !p.marker);
        const bList = (Array.isArray(bData?.prompts) ? bData.prompts : []).filter(p => p && !p.marker);
        const bMap = new Map(bList.map(p => [p.identifier, p]));
        const rows = [];
        const seen = new Set();
        for (const a of aList) {
            rows.push({ id: a.identifier, a, b: bMap.get(a.identifier) ?? null });
            seen.add(a.identifier);
        }
        for (const b of bList) {
            if (!seen.has(b.identifier)) rows.push({ id: b.identifier, a: null, b });
        }
        return rows;
    };

    const statusOf = (row) => {
        if (!row.a) return 'only_b';
        if (!row.b) return 'only_a';
        return String(row.a.content ?? '') === String(row.b.content ?? '') ? 'same' : 'diff';
    };

    const promptRow = (row) => {
        const el = document.createElement('div');
        el.className = 'ps-var-row ps-cmp-row';
        const name = String(row.a?.name ?? row.b?.name ?? row.id);
        el.innerHTML = `
            <div class="ps-var-head ps-cmp-head">
                <span class="ps-cmp-name">${escapeHtml(name)}</span>
                <span class="ps-badge ps-cmp-badge"></span>
            </div>
        `;
        const badge = el.querySelector('.ps-cmp-badge');
        const setBadge = () => {
            const status = statusOf(row);
            badge.textContent = t(`cmp_status_${status}`);
            badge.className = `ps-badge ps-cmp-badge ps-cmp-${status}`;
        };
        setBadge();
        el.querySelector('.ps-cmp-head').addEventListener('click', () => {
            expandedId = expandedId === row.id ? null : row.id;
            renderList();
        });
        if (expandedId !== row.id) return el;

        // --- expanded dual editor ---
        const editor = document.createElement('div');
        editor.className = 'ps-cmp-editor';
        const aEditable = !!row.a && perms.canEdit(row.a);
        editor.innerHTML = `
            <div class="ps-cmp-cols">
                <div class="ps-cmp-col">
                    <div class="ps-cmp-col-head" title="${escapeHtml(active)}">${escapeHtml(t('cmp_active', { name: active || '—' }))}</div>
                    ${row.a
                        ? `<textarea class="text_pole ps-cmp-ta ps-cmp-ta-a ps-mono" rows="8" ${aEditable ? '' : 'readonly'}></textarea>`
                        : `<div class="ps-note" data-ps-i18n="cmp_a_missing"></div>`}
                </div>
                <div class="ps-cmp-col">
                    <div class="ps-cmp-col-head" title="${escapeHtml(comparedName)}">${escapeHtml(comparedName)}</div>
                    ${row.b
                        ? `<textarea class="text_pole ps-cmp-ta ps-cmp-ta-b ps-mono" rows="8"></textarea>`
                        : `<div class="ps-note" data-ps-i18n="cmp_b_missing"></div>`}
                </div>
            </div>
            <div class="ps-cmp-actions">
                ${row.a && row.b ? `
                <div class="menu_button ps-btn ps-cmp-ab" data-ps-i18n="[title]cmp_copy_ab_title"><span data-ps-i18n="cmp_copy_ab"></span> <i class="fa-solid fa-arrow-right"></i></div>
                <div class="menu_button ps-btn ps-cmp-ba ${aEditable ? '' : 'disabled'}" data-ps-i18n="[title]cmp_copy_ba_title"><i class="fa-solid fa-arrow-left"></i> <span data-ps-i18n="cmp_copy_ba"></span></div>
                <div class="menu_button ps-btn ps-cmp-diffbtn"><i class="fa-solid fa-code-compare"></i> <span data-ps-i18n="cmp_show_diff"></span></div>` : ''}
            </div>
            <div class="ps-cmp-diffhost" style="display:none"></div>
        `;
        localize(editor);

        const taA = editor.querySelector('.ps-cmp-ta-a');
        const taB = editor.querySelector('.ps-cmp-ta-b');
        const diffHost = editor.querySelector('.ps-cmp-diffhost');
        if (taA) taA.value = String(row.a.content ?? '');
        if (taB) taB.value = String(row.b.content ?? '');

        const refreshDiff = () => {
            if (diffHost.style.display === 'none') return;
            // old = active preset, new = second preset
            renderDiff(diffHost, taA?.value ?? '', taB?.value ?? '', { legendKey: 'diff_legend_presets' });
        };

        if (taA && aEditable) {
            const saveA = debounce(async () => {
                await applyPromptPatch(row.id, { content: taA.value });
                nav.markDirty();
                row.a = getPromptById(row.id) ?? row.a;
                setBadge();
            }, 500);
            taA.addEventListener('input', () => {
                saveA();
                refreshDiff();
            });
        }
        if (taB) {
            taB.addEventListener('input', () => {
                row.b.content = taB.value;
                markBDirty();
                setBadge();
                refreshDiff();
            });
        }

        editor.querySelector('.ps-cmp-ab')?.addEventListener('click', () => {
            taB.value = taA.value;
            row.b.content = taA.value;
            markBDirty();
            setBadge();
            refreshDiff();
        });
        editor.querySelector('.ps-cmp-ba')?.addEventListener('click', async () => {
            if (!aEditable) return;
            taA.value = taB.value;
            await applyPromptPatch(row.id, { content: taB.value });
            nav.markDirty();
            row.a = getPromptById(row.id) ?? row.a;
            setBadge();
            refreshDiff();
        });
        editor.querySelector('.ps-cmp-diffbtn')?.addEventListener('click', () => {
            if (diffHost.style.display === 'none') {
                diffHost.style.display = '';
                refreshDiff();
            } else {
                diffHost.style.display = 'none';
            }
        });

        el.appendChild(editor);
        return el;
    };

    const renderList = () => {
        const query = searchValue.trim().toLowerCase();
        listHost.textContent = '';
        const rows = buildRows().filter(row => {
            if (!query) return true;
            return String(row.a?.name ?? row.b?.name ?? row.id).toLowerCase().includes(query);
        });
        for (const row of rows) listHost.appendChild(promptRow(row));
        if (!rows.length) {
            listHost.innerHTML = `<div class="ps-empty" data-ps-i18n="ref_empty"></div>`;
            localize(listHost);
        }
    };

    pick.addEventListener('change', async () => {
        // Flush pending edits of the old preset before switching.
        saveB.cancel();
        if (bDirty && bData) {
            bDirty = false;
            await savePresetByName(comparedName, bData);
        }
        comparedName = pick.value;
        expandedId = null;
        bData = readPresetByName(comparedName);
        bDirty = false;
        statusEl.textContent = '';
        if (!bData) {
            console.error(LOG, 'compare preset read failed', comparedName);
            toast()?.error(t('toast_error'));
        }
        renderList();
    });
    searchEl.addEventListener('input', debounce(() => {
        searchValue = searchEl.value;
        renderList();
    }, 200));

    renderList();
}
