// Reference tab: searchable, category-grouped macro documentation built from
// ST's macro registry, plus the current chat-local/global variables. Rows can
// insert a macro template into the active editor textarea.

import { t, localize, getLang } from './i18n.js';
import { LOG, escapeHtml, insertAtCursor } from './util.js';
import { getAllMacros, getVariables } from './st-bridge.js';

const toast = () => globalThis.toastr;

const CATEGORY_ORDER = ['names', 'character', 'chat', 'variable', 'time', 'random', 'utility', 'prompts', 'state', 'misc', 'uncategorized'];

// Minimal fallback when the macro registry is unavailable (older ST).
const FALLBACK = [
    { name: 'user', sig: '{{user}}', desc: { en: 'Your persona name.', ru: 'Имя вашей персоны.' } },
    { name: 'char', sig: '{{char}}', desc: { en: 'Character name.', ru: 'Имя персонажа.' } },
    { name: 'description', sig: '{{description}}', desc: { en: 'Character description.', ru: 'Описание персонажа.' } },
    { name: 'personality', sig: '{{personality}}', desc: { en: 'Character personality.', ru: 'Характер персонажа.' } },
    { name: 'scenario', sig: '{{scenario}}', desc: { en: 'Chat scenario.', ru: 'Сценарий чата.' } },
    { name: 'persona', sig: '{{persona}}', desc: { en: 'Your persona description.', ru: 'Описание вашей персоны.' } },
    { name: 'lastMessage', sig: '{{lastMessage}}', desc: { en: 'Last chat message.', ru: 'Последнее сообщение чата.' } },
    { name: 'input', sig: '{{input}}', desc: { en: 'User input bar text.', ru: 'Текст в поле ввода.' } },
    { name: 'time', sig: '{{time}}', desc: { en: 'Current time.', ru: 'Текущее время.' } },
    { name: 'date', sig: '{{date}}', desc: { en: 'Current date.', ru: 'Текущая дата.' } },
    { name: 'random', sig: '{{random::a::b}}', desc: { en: 'Random item from the list.', ru: 'Случайный элемент списка.' } },
    { name: 'pick', sig: '{{pick::a::b}}', desc: { en: 'Like random, but stable per chat.', ru: 'Как random, но стабильно для чата.' } },
    { name: 'roll', sig: '{{roll:1d20}}', desc: { en: 'Dice roll.', ru: 'Бросок кубика.' } },
    { name: 'getvar', sig: '{{getvar::name}}', desc: { en: 'Read a chat-local variable.', ru: 'Прочитать локальную переменную чата.' } },
    { name: 'setvar', sig: '{{setvar::name::value}}', desc: { en: 'Set a chat-local variable.', ru: 'Установить локальную переменную чата.' } },
    { name: 'getglobalvar', sig: '{{getglobalvar::name}}', desc: { en: 'Read a global variable.', ru: 'Прочитать глобальную переменную.' } },
    { name: 'setglobalvar', sig: '{{setglobalvar::name::value}}', desc: { en: 'Set a global variable.', ru: 'Установить глобальную переменную.' } },
    { name: 'newline', sig: '{{newline}}', desc: { en: 'Inserts a newline.', ru: 'Вставляет перенос строки.' } },
    { name: 'trim', sig: '{{trim}}', desc: { en: 'Trims newlines around it.', ru: 'Убирает переносы вокруг себя.' } },
    { name: '//', sig: '{{// comment}}', desc: { en: 'Comment (removed from the prompt).', ru: 'Комментарий (удаляется из промпта).' } },
];

function buildSignature(def) {
    if (def.displayOverride) return def.displayOverride;
    const args = (def.unnamedArgDefs ?? []).map((arg, i) => {
        const optional = i >= (def.minArgs ?? 0);
        return `${optional ? '?' : ''}${arg?.name || 'arg'}`;
    });
    if (def.list) args.push('…');
    return args.length ? `{{${def.name}::${args.join('::')}}}` : `{{${def.name}}}`;
}

function categoryTitle(category) {
    const key = `cat_${String(category || 'uncategorized')}`;
    const title = t(key);
    return title === key ? String(category) : title;
}

export async function renderReferenceTab(body, nav) {
    body.innerHTML = `
        <div class="ps-ref">
            <input type="search" class="text_pole ps-ref-search" data-ps-i18n="[placeholder]ref_search_placeholder">
            <div class="ps-ref-notice"></div>
            <div class="ps-ref-list"></div>
            <div class="ps-ref-vars"></div>
        </div>
    `;
    localize(body);
    const list = body.querySelector('.ps-ref-list');
    const search = body.querySelector('.ps-ref-search');

    let defs = [];
    let usingFallback = false;
    try {
        defs = getAllMacros().filter(def => def && !def.aliasOf);
    } catch (err) {
        console.error(LOG, 'macro registry read failed', err);
    }
    if (!defs.length) {
        usingFallback = true;
        const notice = body.querySelector('.ps-ref-notice');
        notice.className = 'ps-note';
        notice.setAttribute('data-ps-i18n', 'ref_registry_missing');
        localize(notice);
    }

    const insertText = (text) => {
        const target = nav.getInsertTarget();
        if (target) {
            insertAtCursor(target, text);
            toast()?.success(t('block_inserted'));
        } else {
            navigator.clipboard?.writeText(text)
                .then(() => toast()?.success(t('ref_copied')))
                .catch(() => toast()?.warning(t('block_no_target')));
        }
    };

    const renderRows = () => {
        const query = search.value.trim().toLowerCase();
        list.textContent = '';

        if (usingFallback) {
            const isRu = getLang() === 'ru';
            for (const item of FALLBACK) {
                const desc = isRu ? item.desc.ru : item.desc.en;
                if (query && !(item.name + ' ' + item.sig + ' ' + desc).toLowerCase().includes(query)) continue;
                list.appendChild(fallbackRow(item.sig, desc, insertText));
            }
            if (!list.children.length) {
                list.innerHTML = `<div class="ps-empty" data-ps-i18n="ref_empty"></div>`;
                localize(list);
            }
            return;
        }

        const groups = new Map();
        for (const def of defs) {
            const haystack = [
                def.name,
                def.description,
                def.returns,
                categoryTitle(def.category),
                ...(def.aliases ?? []).map(a => (typeof a === 'string' ? a : (a?.alias ?? a?.name)) ?? ''),
                ...(def.unnamedArgDefs ?? []).map(a => `${a?.name ?? ''} ${a?.description ?? ''}`),
            ].join(' ').toLowerCase();
            if (query && !haystack.includes(query)) continue;
            const cat = String(def.category || 'uncategorized');
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push(def);
        }

        const orderedCats = [...groups.keys()].sort((a, b) => {
            const ia = CATEGORY_ORDER.indexOf(a);
            const ib = CATEGORY_ORDER.indexOf(b);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });

        for (const cat of orderedCats) {
            const head = document.createElement('div');
            head.className = 'ps-ref-cat';
            head.textContent = categoryTitle(cat);
            list.appendChild(head);
            for (const def of groups.get(cat).sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
                list.appendChild(macroRow(def, insertText));
            }
        }
        if (!list.children.length) {
            list.innerHTML = `<div class="ps-empty" data-ps-i18n="ref_empty"></div>`;
            localize(list);
        }
    };

    search.addEventListener('input', () => renderRows());
    renderRows();
    renderVariables(body.querySelector('.ps-ref-vars'), insertText);
}

function fallbackRow(signature, description, insertText) {
    const row = document.createElement('div');
    row.className = 'ps-ref-row';
    row.innerHTML = `
        <div class="ps-ref-row-head">
            <code class="ps-ref-sig">${escapeHtml(signature)}</code>
            <span class="ps-ref-desc">${escapeHtml(description)}</span>
            <div class="menu_button ps-btn ps-ref-insert" data-ps-i18n="[title]insert"><i class="fa-solid fa-arrow-right-to-bracket"></i></div>
        </div>
    `;
    localize(row);
    row.querySelector('.ps-ref-insert').addEventListener('click', (event) => {
        event.stopPropagation();
        insertText(signature);
    });
    return row;
}

function macroRow(def, insertText) {
    const signature = buildSignature(def);
    const row = document.createElement('div');
    row.className = 'ps-ref-row';
    row.innerHTML = `
        <div class="ps-ref-row-head">
            <code class="ps-ref-sig">${escapeHtml(signature)}</code>
            <span class="ps-ref-desc">${escapeHtml(def.description ?? '')}</span>
            <div class="menu_button ps-btn ps-ref-insert" data-ps-i18n="[title]insert"><i class="fa-solid fa-arrow-right-to-bracket"></i></div>
        </div>
        <div class="ps-ref-row-details" style="display:none"></div>
    `;
    localize(row);
    row.querySelector('.ps-ref-insert').addEventListener('click', (event) => {
        event.stopPropagation();
        insertText(signature);
    });
    row.querySelector('.ps-ref-row-head').addEventListener('click', () => {
        const details = row.querySelector('.ps-ref-row-details');
        if (details.style.display !== 'none') {
            details.style.display = 'none';
            return;
        }
        if (!details.childNodes.length) {
            let html = '';
            if (def.description) html += `<div>${escapeHtml(def.description)}</div>`;
            const args = def.unnamedArgDefs ?? [];
            if (args.length) {
                html += `<div class="ps-ref-detail"><b>${escapeHtml(t('ref_args'))}</b> ${args.map(a => `<code>${escapeHtml(a?.name ?? 'arg')}</code>${a?.description ? ' — ' + escapeHtml(a.description) : ''}`).join('; ')}</div>`;
            }
            if (def.returns) html += `<div class="ps-ref-detail"><b>${escapeHtml(t('ref_returns'))}</b> ${escapeHtml(def.returns)}</div>`;
            const aliases = (def.aliases ?? []).map(a => (typeof a === 'string' ? a : (a?.alias ?? a?.name))).filter(Boolean);
            if (aliases.length) html += `<div class="ps-ref-detail"><b>${escapeHtml(t('ref_aliases'))}</b> ${aliases.map(a => `<code>{{${escapeHtml(a)}}}</code>`).join(', ')}</div>`;
            const examples = Array.isArray(def.exampleUsage) ? def.exampleUsage : (def.exampleUsage ? [def.exampleUsage] : []);
            if (examples.length) html += `<div class="ps-ref-detail"><b>${escapeHtml(t('ref_example'))}</b> ${examples.map(e => `<code>${escapeHtml(e)}</code>`).join(' ')}</div>`;
            details.innerHTML = html || `<div class="ps-muted">—</div>`;
        }
        details.style.display = '';
    });
    return row;
}

function renderVariables(host, insertText) {
    const { local, global } = getVariables();
    const section = (titleKey, vars, macroName) => {
        const names = Object.keys(vars);
        const rows = names.length
            ? names.map(name => {
                const value = String(vars[name] ?? '');
                const shown = value.length > 80 ? value.slice(0, 80) + '…' : value;
                return `
                    <div class="ps-var-row" data-name="${escapeHtml(name)}" data-macro="${macroName}">
                        <code>${escapeHtml(name)}</code>
                        <span class="ps-muted ps-var-value">${escapeHtml(shown)}</span>
                        <div class="menu_button ps-btn ps-var-insert" data-ps-i18n="[title]insert"><i class="fa-solid fa-arrow-right-to-bracket"></i></div>
                    </div>`;
            }).join('')
            : `<span class="ps-muted" data-ps-i18n="ref_vars_empty"></span>`;
        return `<div class="ps-var-section"><b data-ps-i18n="${titleKey}"></b>${rows}</div>`;
    };
    host.innerHTML = `
        <div class="ps-ref-cat" data-ps-i18n="ref_vars_title"></div>
        <div class="ps-note" data-ps-i18n="ref_vars_note"></div>
        ${section('ref_vars_local', local, 'getvar')}
        ${section('ref_vars_global', global, 'getglobalvar')}
    `;
    localize(host);
    host.addEventListener('click', (event) => {
        const button = event.target.closest('.ps-var-insert');
        if (!button) return;
        const row = button.closest('.ps-var-row');
        insertText(`{{${row.dataset.macro}::${row.dataset.name}}}`);
    });
}
