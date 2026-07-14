// Live preview of a single prompt (macros substituted against the open chat)
// and the whole-preset dry-run view (the exact message list ST would send).

import { t, localize } from './i18n.js';
import { LOG, escapeHtml, debounce, hashContent } from './util.js';
import { substitute, countTokens, dryRunPreset, hasOpenCharacter, caps } from './st-bridge.js';

const toast = () => globalThis.toastr;

const tokenCache = new Map(); // hash -> count
const TOKEN_CACHE_MAX = 500;

async function cachedTokenCount(text) {
    const key = hashContent(text);
    if (tokenCache.has(key)) return tokenCache.get(key);
    const n = await countTokens(text);
    if (n !== null) {
        if (tokenCache.size > TOKEN_CACHE_MAX) tokenCache.clear();
        tokenCache.set(key, n);
    }
    return n;
}

/**
 * Collapsible substituted-preview block under the prompt editor.
 * @returns {{update: () => void}}
 */
export function renderInlinePreview(container, getText) {
    container.innerHTML = `
        <div class="ps-preview">
            <div class="ps-preview-head">
                <b data-ps-i18n="preview_title"></b>
                <span class="ps-preview-tokens ps-muted"></span>
                <span class="ps-muted ps-preview-note" data-ps-i18n="preview_note"></span>
            </div>
            <pre class="ps-preview-body"></pre>
        </div>
    `;
    localize(container);
    const bodyEl = container.querySelector('.ps-preview-body');
    const tokensEl = container.querySelector('.ps-preview-tokens');

    let generation = 0;
    const update = debounce(async () => {
        const my = ++generation;
        try {
            const substituted = substitute(getText());
            if (my !== generation || !bodyEl.isConnected) return;
            bodyEl.textContent = substituted;
            if (caps.tokens) {
                tokensEl.textContent = t('tokens_counting');
                const n = await cachedTokenCount(substituted);
                if (my !== generation || !bodyEl.isConnected) return;
                tokensEl.textContent = n !== null ? t('preview_tokens', { n }) : '';
            }
        } catch (err) {
            console.error(LOG, 'preview failed', err);
        }
    }, 300);
    update();
    return { update };
}

let lastDryRun = null; // { chat: [{role, content}], presetName }

/** The whole-preset dry-run view (opened by the header "Dry run" button). */
export async function renderDryRunView(body, nav) {
    body.innerHTML = `
        <div class="ps-dryrun">
            <div class="ps-dryrun-toolbar">
                <div class="menu_button ps-btn ps-dr-back"><i class="fa-solid fa-arrow-left"></i> <span data-ps-i18n="back"></span></div>
                <b data-ps-i18n="dryrun_title"></b>
                <div class="menu_button ps-btn ps-dr-run"><i class="fa-solid fa-flask"></i> <span data-ps-i18n="dryrun_run"></span></div>
                <span class="ps-dr-total ps-muted"></span>
            </div>
            <div class="ps-note" data-ps-i18n="dryrun_note"></div>
            <div class="ps-dryrun-list"></div>
        </div>
    `;
    localize(body);
    const list = body.querySelector('.ps-dryrun-list');
    const totalEl = body.querySelector('.ps-dr-total');
    const runButton = body.querySelector('.ps-dr-run');
    body.querySelector('.ps-dr-back').addEventListener('click', () => nav.openTab('prompts'));

    const renderChat = async (chat) => {
        list.textContent = '';
        if (!chat?.length) {
            list.innerHTML = `<div class="ps-empty" data-ps-i18n="dryrun_empty"></div>`;
            localize(list);
            return;
        }
        const rows = [];
        for (const message of chat) {
            const row = document.createElement('div');
            row.className = `ps-dr-msg ps-dr-role-${escapeHtml(String(message.role ?? 'system'))}`;
            row.innerHTML = `
                <div class="ps-dr-msg-head">
                    <span class="ps-badge">${escapeHtml(String(message.role ?? ''))}</span>
                    ${message.name ? `<span class="ps-muted">${escapeHtml(String(message.name))}</span>` : ''}
                    <span class="ps-dr-msg-tokens ps-muted"></span>
                </div>
                <pre class="ps-dr-msg-body"></pre>
            `;
            const content = typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content, null, 2);
            row.querySelector('.ps-dr-msg-body').textContent = content;
            list.appendChild(row);
            rows.push({ row, content });
        }
        if (caps.tokens) {
            let total = 0;
            for (const { row, content } of rows) {
                if (!row.isConnected) return;
                const n = await cachedTokenCount(content);
                if (n !== null) {
                    total += n;
                    row.querySelector('.ps-dr-msg-tokens').textContent = t('tokens_label', { n });
                }
            }
            totalEl.textContent = t('dryrun_total', { n: total, m: chat.length });
        } else {
            totalEl.textContent = t('dryrun_total', { n: '?', m: chat.length });
        }
    };

    runButton.addEventListener('click', async () => {
        if (!hasOpenCharacter()) {
            toast()?.warning(t('dryrun_need_chat'));
            return;
        }
        runButton.classList.add('disabled');
        totalEl.textContent = '';
        list.innerHTML = `<div class="ps-empty" data-ps-i18n="dryrun_running"></div>`;
        localize(list);
        try {
            const result = await dryRunPreset();
            if (!result) {
                list.innerHTML = `<div class="ps-empty" data-ps-i18n="dryrun_failed"></div>`;
                localize(list);
                return;
            }
            lastDryRun = { chat: result.chat };
            await renderChat(result.chat);
        } catch (err) {
            console.error(LOG, 'dry run render failed', err);
            list.textContent = t('dryrun_failed');
        } finally {
            runButton.classList.remove('disabled');
        }
    });

    await renderChat(lastDryRun?.chat ?? null);
}
