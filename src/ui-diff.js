// Shared diff rendering: old/new line numbers, folded runs of unchanged
// lines, word-level highlights inside changed lines and a +/−/~ summary.
// Used by the History tab and the preset compare tab.

import { t } from './i18n.js';
import { escapeHtml } from './util.js';
import { diffLines } from './diff.js';

const CONTEXT = 2;   // unchanged lines kept visible around a change
const FOLD_MIN = 4;  // fold only when it hides at least this many lines

function lineHtml(op, oldNo, newNo) {
    const numbers = `<span class="ps-diff-no">${oldNo ?? ''}</span><span class="ps-diff-no">${newNo ?? ''}</span>`;
    if (op.type === 'same') {
        return `<div class="ps-diff-line">${numbers}<span class="ps-diff-text">${escapeHtml(op.text) || '&nbsp;'}</span></div>`;
    }
    if (op.type === 'del') {
        return `<div class="ps-diff-line ps-diff-del">${numbers}<span class="ps-diff-text">${escapeHtml(op.text) || '&nbsp;'}</span></div>`;
    }
    if (op.type === 'add') {
        return `<div class="ps-diff-line ps-diff-add">${numbers}<span class="ps-diff-text">${escapeHtml(op.text) || '&nbsp;'}</span></div>`;
    }
    let line = '';
    for (const word of op.words) {
        if (word.type === 'same') line += escapeHtml(word.text);
        else if (word.type === 'del') line += `<span class="ps-diff-del">${escapeHtml(word.text)}</span>`;
        else line += `<span class="ps-diff-add">${escapeHtml(word.text)}</span>`;
    }
    return `<div class="ps-diff-line ps-diff-chg">${numbers}<span class="ps-diff-text">${line || '&nbsp;'}</span></div>`;
}

/**
 * Render a diff of two texts into `host`.
 * @param {HTMLElement} host
 * @param {string} oldText
 * @param {string} newText
 * @param {{legendKey?: string}} [options] - i18n key explaining what red/green
 *   mean in this context (direction differs between history and compare).
 * @returns {{add: number, del: number, chg: number, same: boolean}}
 */
export function renderDiff(host, oldText, newText, { legendKey = 'diff_legend_snapshot' } = {}) {
    const ops = diffLines(oldText, newText);
    let add = 0, del = 0, chg = 0;
    for (const op of ops) {
        if (op.type === 'add') add++;
        else if (op.type === 'del') del++;
        else if (op.type === 'change') chg++;
    }
    if (add === 0 && del === 0 && chg === 0) {
        host.innerHTML = `<div class="ps-diff-summary"><span class="ps-muted">${escapeHtml(t('diff_same'))}</span></div>`;
        return { add, del, chg, same: true };
    }

    let oldNo = 1;
    let newNo = 1;
    const chunks = [];
    let k = 0;
    while (k < ops.length) {
        if (ops[k].type !== 'same') {
            const op = ops[k++];
            if (op.type === 'del') chunks.push(lineHtml(op, oldNo++, null));
            else if (op.type === 'add') chunks.push(lineHtml(op, null, newNo++));
            else chunks.push(lineHtml(op, oldNo++, newNo++));
            continue;
        }
        const start = k;
        while (k < ops.length && ops[k].type === 'same') k++;
        const run = ops.slice(start, k);
        const headCtx = start === 0 ? 0 : CONTEXT;
        const tailCtx = k === ops.length ? 0 : CONTEXT;
        if (run.length <= headCtx + tailCtx + FOLD_MIN) {
            for (const op of run) chunks.push(lineHtml(op, oldNo++, newNo++));
            continue;
        }
        for (let i = 0; i < headCtx; i++) chunks.push(lineHtml(run[i], oldNo++, newNo++));
        const hiddenCount = run.length - headCtx - tailCtx;
        let hiddenHtml = '';
        for (let i = headCtx; i < run.length - tailCtx; i++) hiddenHtml += lineHtml(run[i], oldNo++, newNo++);
        chunks.push(`
            <div class="ps-diff-fold">
                <div class="ps-diff-fold-btn" title="${escapeHtml(t('diff_fold_title'))}">⋯ ${escapeHtml(t('diff_fold', { n: hiddenCount }))} ⋯</div>
                <div class="ps-diff-fold-body" style="display:none">${hiddenHtml}</div>
            </div>`);
        for (let i = run.length - tailCtx; i < run.length; i++) chunks.push(lineHtml(run[i], oldNo++, newNo++));
    }

    host.innerHTML = `
        <div class="ps-diff-summary">
            <span class="ps-diff-stat" title="${escapeHtml(t('diff_stat_title'))}">
                <span class="ps-diff-stat-add">+${add}</span>
                <span class="ps-diff-stat-del">−${del}</span>
                <span class="ps-diff-stat-chg">~${chg}</span>
            </span>
            <span class="ps-muted ps-diff-legend">${escapeHtml(t(legendKey))}</span>
        </div>
        <div class="ps-diff">${chunks.join('')}</div>
    `;
    for (const btn of host.querySelectorAll('.ps-diff-fold-btn')) {
        btn.addEventListener('click', () => {
            btn.style.display = 'none';
            btn.nextElementSibling.style.display = '';
        });
    }
    return { add, del, chg, same: false };
}
