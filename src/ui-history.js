// History tab: snapshots of the current preset, filterable by prompt, with a
// line/word-level diff against the live content (line numbers, folded
// unchanged runs, +/−/~ summary), restore and delete.

import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';
import { t, localize } from './i18n.js';
import { LOG, escapeHtml } from './util.js';
import { getSettings, listSnapshots, listSnapshotPrompts, deleteSnapshot, addSnapshot } from './state.js';
import { currentPresetName, getPromptById, applyPromptPatch, perms } from './st-bridge.js';
import { renderDiff } from './ui-diff.js';

const toast = () => globalThis.toastr;

function roleLabel(role) {
    const known = ['system', 'user', 'assistant'];
    return t(`role_${known.includes(role) ? role : 'system'}`);
}

export async function renderHistoryTab(body, nav, params = {}) {
    const presetName = currentPresetName();
    const identifiers = listSnapshotPrompts(presetName);
    const filter = params.identifier && identifiers.includes(params.identifier) ? params.identifier : '';

    const promptLabel = (identifier) => {
        const live = getPromptById(identifier);
        if (live) return live.name || identifier;
        const bucket = listSnapshots(presetName, identifier);
        return (bucket[0]?.name || identifier) + ` (${t('snap_prompt_gone')})`;
    };

    body.innerHTML = `
        <div class="ps-history">
            <div class="ps-history-toolbar">
                <b>${escapeHtml(t('history_preset', { name: presetName || '—' }))}</b>
                <select class="text_pole ps-history-filter">
                    <option value="">${escapeHtml(t('history_pick_prompt'))}</option>
                    ${identifiers.map(id => `<option value="${escapeHtml(id)}" ${id === filter ? 'selected' : ''}>${escapeHtml(promptLabel(id))}</option>`).join('')}
                </select>
            </div>
            <div class="ps-history-list"></div>
        </div>
    `;
    const list = body.querySelector('.ps-history-list');
    body.querySelector('.ps-history-filter').addEventListener('change', (event) => {
        nav.openTab('history', { identifier: event.target.value || undefined });
    });

    const shown = filter ? [filter] : identifiers;
    let empty = true;
    for (const identifier of shown) {
        const bucket = listSnapshots(presetName, identifier);
        if (!bucket.length) continue;
        empty = false;

        const group = document.createElement('div');
        group.className = 'ps-history-group';
        group.innerHTML = `<div class="ps-history-group-head">${escapeHtml(promptLabel(identifier))}</div>`;
        list.appendChild(group);

        for (const entry of bucket) {
            const row = document.createElement('div');
            row.className = 'ps-snap';
            const when = entry.ts ? new Date(entry.ts).toLocaleString() : '—';
            row.innerHTML = `
                <div class="ps-snap-head">
                    <span class="ps-snap-when">${escapeHtml(when)}</span>
                    ${entry.note ? `<span class="ps-snap-note">${escapeHtml(entry.note)}</span>` : ''}
                    ${entry.truncated ? `<span class="ps-badge ps-badge-warn" data-ps-i18n="[title]snapshot_truncated_warn">✂</span>` : ''}
                    <span class="ps-snap-actions">
                        <div class="menu_button ps-btn ps-snap-diff"><i class="fa-solid fa-code-compare"></i> <span data-ps-i18n="diff_vs_current"></span></div>
                        <div class="menu_button ps-btn ps-snap-restore"><i class="fa-solid fa-rotate-left"></i> <span data-ps-i18n="snap_restore"></span></div>
                        <div class="menu_button ps-btn ps-danger ps-snap-delete" data-ps-i18n="[title]snap_delete"><i class="fa-solid fa-trash"></i></div>
                    </span>
                </div>
                <div class="ps-snap-body" style="display:none"></div>
            `;
            localize(row);
            group.appendChild(row);

            const bodyEl = row.querySelector('.ps-snap-body');
            row.querySelector('.ps-snap-diff').addEventListener('click', () => {
                if (bodyEl.style.display !== 'none') {
                    bodyEl.style.display = 'none';
                    return;
                }
                const live = getPromptById(identifier);
                try {
                    bodyEl.textContent = '';
                    // Name/role changes are invisible in a content diff — list them.
                    const metaBits = [];
                    if (String(live?.name ?? '') !== String(entry.name ?? '')) {
                        metaBits.push(`${t('diff_meta_name')}: «${live?.name ?? '—'}» → «${entry.name || '—'}»`);
                    }
                    if (String(live?.role ?? '') !== String(entry.role ?? '')) {
                        metaBits.push(`${t('diff_meta_role')}: ${roleLabel(live?.role)} → ${roleLabel(entry.role)}`);
                    }
                    if (metaBits.length) {
                        const meta = document.createElement('div');
                        meta.className = 'ps-diff-meta';
                        meta.textContent = metaBits.join(' · ');
                        bodyEl.appendChild(meta);
                    }
                    const diffHost = document.createElement('div');
                    bodyEl.appendChild(diffHost);
                    // old = current text, new = the snapshot (what restore brings back)
                    renderDiff(diffHost, String(live?.content ?? ''), entry.content, { legendKey: 'diff_legend_snapshot' });
                } catch (err) {
                    console.error(LOG, 'diff failed', err);
                    bodyEl.textContent = t('toast_error');
                }
                bodyEl.style.display = '';
            });

            const restoreButton = row.querySelector('.ps-snap-restore');
            const live = getPromptById(identifier);
            if (!live || !perms.canEdit(live)) restoreButton.classList.add('disabled');
            restoreButton.addEventListener('click', async () => {
                const target = getPromptById(identifier);
                if (!target || !perms.canEdit(target)) return;
                if (getSettings().confirmRestore) {
                    const ok = await callGenericPopup(t('confirm_restore'), POPUP_TYPE.CONFIRM ?? 2);
                    if (ok !== (POPUP_RESULT?.AFFIRMATIVE ?? 1)) return;
                }
                // Restore is itself undoable: snapshot the pre-restore state first.
                addSnapshot(presetName, identifier, {
                    name: target.name, role: target.role, content: target.content, note: 'pre-restore',
                });
                await applyPromptPatch(identifier, { name: entry.name, role: entry.role, content: entry.content });
                nav.markDirty();
                toast()?.success(t('restore_done'));
                nav.openTab('history', { identifier: filter || undefined });
            });

            row.querySelector('.ps-snap-delete').addEventListener('click', async () => {
                const ok = await callGenericPopup(t('confirm_delete_snapshot'), POPUP_TYPE.CONFIRM ?? 2);
                if (ok !== (POPUP_RESULT?.AFFIRMATIVE ?? 1)) return;
                deleteSnapshot(presetName, identifier, entry.id);
                nav.openTab('history', { identifier: filter || undefined });
            });
        }
    }

    if (empty) {
        list.innerHTML = `<div class="ps-empty" data-ps-i18n="history_empty"></div>`;
        localize(list);
    }
}
