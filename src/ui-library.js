// Blocks tab: CRUD over the reusable text-block library. Insertion goes into
// the last focused editor textarea (nav.getInsertTarget()).

import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';
import { t, localize } from './i18n.js';
import { escapeHtml, insertAtCursor } from './util.js';
import { listBlocks, addBlock, updateBlock, deleteBlock } from './state.js';

const toast = () => globalThis.toastr;

export async function renderBlocksTab(body, nav) {
    body.innerHTML = `
        <div class="ps-blocks">
            <div class="ps-blocks-toolbar">
                <div class="menu_button ps-btn ps-block-new"><i class="fa-solid fa-plus"></i> <span data-ps-i18n="block_new"></span></div>
            </div>
            <div class="ps-blocks-list"></div>
        </div>
    `;
    localize(body);
    const list = body.querySelector('.ps-blocks-list');

    const renderRows = () => {
        list.textContent = '';
        const blocks = listBlocks();
        if (!blocks.length) {
            list.innerHTML = `<div class="ps-empty" data-ps-i18n="blocks_empty"></div>`;
            localize(list);
            return;
        }
        for (const block of blocks) {
            const row = document.createElement('div');
            row.className = 'ps-block';
            row.innerHTML = `
                <div class="ps-block-head">
                    <input type="text" class="text_pole ps-block-name" data-ps-i18n="[placeholder]block_name" value="${escapeHtml(block.name)}">
                    <div class="menu_button ps-btn ps-block-insert"><i class="fa-solid fa-arrow-right-to-bracket"></i> <span data-ps-i18n="insert"></span></div>
                    <div class="menu_button ps-btn ps-danger ps-block-delete" data-ps-i18n="[title]block_delete"><i class="fa-solid fa-trash"></i></div>
                </div>
                <textarea class="text_pole ps-block-content" rows="4" data-ps-i18n="[placeholder]block_content"></textarea>
            `;
            localize(row);
            row.querySelector('.ps-block-content').value = block.content;

            row.querySelector('.ps-block-name').addEventListener('change', (event) => {
                updateBlock(block.id, { name: event.target.value });
            });
            row.querySelector('.ps-block-content').addEventListener('change', (event) => {
                updateBlock(block.id, { content: event.target.value });
            });
            row.querySelector('.ps-block-insert').addEventListener('click', () => {
                const target = nav.getInsertTarget();
                if (!target) {
                    toast()?.warning(t('block_no_target'));
                    return;
                }
                const live = listBlocks().find(b => b.id === block.id);
                insertAtCursor(target, live?.content ?? block.content);
                toast()?.success(t('block_inserted'));
            });
            row.querySelector('.ps-block-delete').addEventListener('click', async () => {
                const ok = await callGenericPopup(t('confirm_delete_block'), POPUP_TYPE.CONFIRM ?? 2);
                if (ok !== (POPUP_RESULT?.AFFIRMATIVE ?? 1)) return;
                deleteBlock(block.id);
                renderRows();
            });
            list.appendChild(row);
        }
    };

    body.querySelector('.ps-block-new').addEventListener('click', async () => {
        const name = await callGenericPopup(t('block_name'), POPUP_TYPE.INPUT ?? 3, '');
        if (!name || typeof name !== 'string' || !name.trim()) return;
        addBlock(name, '');
        renderRows();
    });

    renderRows();
}
