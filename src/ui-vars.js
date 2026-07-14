// Variables tab: manager for chat-local and global {{getvar}}/{{setvar}}
// variables — create, edit values inline, delete, copy/insert macros. Also
// exports the variable picker the prompt editor uses for cursor insertion.
// Built to stay usable with 50+ variables: one flat scrollable list, search,
// compact single-line rows, value editors expand one at a time.

import { callGenericPopup, POPUP_TYPE, POPUP_RESULT, Popup } from '../../../../popup.js';
import { t, localize } from './i18n.js';
import { LOG, escapeHtml, debounce, insertAtCursor } from './util.js';
import {
    getVariables, setVariable, deleteVariable, canEditVariables, hasOpenChat,
} from './st-bridge.js';

const toast = () => globalThis.toastr;

// Mirrors MACRO_VARIABLE_SHORTHAND_PATTERN in ST's MacroLexer: starts with a
// letter, word chars or hyphens inside, ends with a word char.
const SHORTHAND_RE = /^[a-zA-Z](?:[\w-]*\w)?$/;

const FORMS = ['get', 'set', 'add', 'inc', 'dec', 'short'];

let scopeFilter = 'all';
let searchValue = '';
let expandedKey = null; // `${scope}:${name}` of the row with an open value editor

export function buildVarMacro(form, scope, name) {
    const g = scope === 'global';
    switch (form) {
        case 'set': return g ? `{{setglobalvar::${name}::value}}` : `{{setvar::${name}::value}}`;
        case 'add': return g ? `{{addglobalvar::${name}::1}}` : `{{addvar::${name}::1}}`;
        case 'inc': return g ? `{{incglobalvar::${name}}}` : `{{incvar::${name}}}`;
        case 'dec': return g ? `{{decglobalvar::${name}}}` : `{{decvar::${name}}}`;
        case 'short': return SHORTHAND_RE.test(name) ? (g ? `{{$${name}}}` : `{{.${name}}}`) : null;
        default: return g ? `{{getglobalvar::${name}}}` : `{{getvar::${name}}}`;
    }
}

function valueText(value) {
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function listAll() {
    const { local, global } = getVariables();
    const rows = [
        ...Object.entries(local).map(([name, value]) => ({ scope: 'chat', name, value })),
        ...Object.entries(global).map(([name, value]) => ({ scope: 'global', name, value })),
    ];
    rows.sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
    return rows;
}

function matches(row, query) {
    if (!query) return true;
    return `${row.name} ${valueText(row.value)}`.toLowerCase().includes(query);
}

function isValidName(name) {
    return !!name && !/[{}:]/.test(name);
}

function copyText(text) {
    navigator.clipboard?.writeText(text)
        .then(() => toast()?.success(t('vars_copied', { macro: text })))
        .catch(() => toast()?.warning(t('toast_error')));
}

export async function renderVarsTab(body, nav) {
    if (!canEditVariables()) {
        body.innerHTML = `<div class="ps-note ps-note-warn" data-ps-i18n="vars_unavailable"></div>`;
        localize(body);
        return;
    }

    body.innerHTML = `
        <div class="ps-vars">
            <div class="ps-vars-toolbar">
                <div class="menu_button ps-btn ps-vars-new"><i class="fa-solid fa-plus"></i> <span data-ps-i18n="vars_new"></span></div>
                <select class="text_pole ps-vars-scope">
                    <option value="all" data-ps-i18n="vars_scope_all"></option>
                    <option value="chat" data-ps-i18n="vars_scope_chat"></option>
                    <option value="global" data-ps-i18n="vars_scope_global"></option>
                </select>
                <input type="search" class="text_pole ps-vars-search" data-ps-i18n="[placeholder]vars_search">
                <span class="ps-muted ps-vars-count"></span>
            </div>
            <div class="ps-vars-form" style="display:none"></div>
            <div class="ps-vars-nochat"></div>
            <div class="ps-vars-list"></div>
            <details class="ps-cheatsheet ps-vars-help">
                <summary data-ps-i18n="vars_help_title"></summary>
                <div class="ps-cs-body" data-ps-i18n="vars_help_body"></div>
            </details>
        </div>
    `;
    localize(body);

    const list = body.querySelector('.ps-vars-list');
    const countEl = body.querySelector('.ps-vars-count');
    const scopeEl = body.querySelector('.ps-vars-scope');
    const searchEl = body.querySelector('.ps-vars-search');
    const formHost = body.querySelector('.ps-vars-form');
    scopeEl.value = scopeFilter;
    searchEl.value = searchValue;

    if (!hasOpenChat()) {
        const note = body.querySelector('.ps-vars-nochat');
        note.className = 'ps-note ps-vars-nochat';
        note.setAttribute('data-ps-i18n', 'vars_no_chat');
        localize(note);
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

    const varRow = (row) => {
        const key = `${row.scope}:${row.name}`;
        const el = document.createElement('div');
        el.className = 'ps-var-row';
        el.innerHTML = `
            <div class="ps-var-head">
                <span class="ps-badge ps-var-badge" data-ps-i18n="vars_badge_${row.scope}"></span>
                <code class="ps-var-name">${escapeHtml(row.name)}</code>
                <span class="ps-var-preview">${escapeHtml(valueText(row.value))}</span>
                <div class="ps-var-actions">
                    <div class="menu_button ps-btn ps-var-insert" data-ps-i18n="[title]vars_insert"><i class="fa-solid fa-arrow-right-to-bracket"></i></div>
                    <div class="menu_button ps-btn ps-var-copy" data-ps-i18n="[title]vars_copy"><i class="fa-solid fa-copy"></i></div>
                    <div class="menu_button ps-btn ps-var-edit" data-ps-i18n="[title]vars_edit"><i class="fa-solid fa-pen"></i></div>
                    <div class="menu_button ps-btn ps-danger ps-var-delete" data-ps-i18n="[title]vars_delete"><i class="fa-solid fa-trash"></i></div>
                </div>
            </div>
        `;
        localize(el);

        el.querySelector('.ps-var-insert').addEventListener('click', () => {
            insertText(buildVarMacro('get', row.scope, row.name));
        });
        el.querySelector('.ps-var-copy').addEventListener('click', () => {
            copyText(buildVarMacro('get', row.scope, row.name));
        });
        el.querySelector('.ps-var-delete').addEventListener('click', async () => {
            const ok = await callGenericPopup(t('vars_confirm_delete', { name: row.name }), POPUP_TYPE.CONFIRM ?? 2);
            if (ok !== (POPUP_RESULT?.AFFIRMATIVE ?? 1)) return;
            if (expandedKey === key) expandedKey = null;
            deleteVariable(row.scope === 'global' ? 'global' : 'local', row.name);
            toast()?.success(t('vars_deleted'));
            renderList();
        });
        el.querySelector('.ps-var-edit').addEventListener('click', () => {
            expandedKey = expandedKey === key ? null : key;
            renderList();
        });

        if (expandedKey === key) {
            const scopeApi = row.scope === 'global' ? 'global' : 'local';
            const editor = document.createElement('div');
            editor.className = 'ps-var-editor';
            const formRows = FORMS.map(form => {
                const macro = buildVarMacro(form, row.scope, row.name);
                if (!macro) return ''; // shorthand form with an incompatible name
                return `
                    <div class="ps-var-form-row" data-macro="${escapeHtml(macro)}" title="${escapeHtml(t(`vars_fd_${form}`))}">
                        <span class="ps-var-form-label" data-ps-i18n="vars_f_${form}"></span>
                        <code class="ps-var-form-macro">${escapeHtml(macro)}</code>
                        <div class="menu_button ps-btn ps-var-form-insert" data-ps-i18n="[title]vars_insert_macro"><i class="fa-solid fa-arrow-right-to-bracket"></i></div>
                        <div class="menu_button ps-btn ps-var-form-copy" data-ps-i18n="[title]copy"><i class="fa-solid fa-copy"></i></div>
                    </div>`;
            }).join('');
            editor.innerHTML = `
                <textarea class="text_pole ps-var-value ps-mono" rows="2"></textarea>
                <div class="ps-var-quick">
                    <div class="menu_button ps-btn ps-var-dec" data-ps-i18n="[title]vars_dec_title"><i class="fa-solid fa-minus"></i> 1</div>
                    <div class="menu_button ps-btn ps-var-inc" data-ps-i18n="[title]vars_inc_title"><i class="fa-solid fa-plus"></i> 1</div>
                    <div class="menu_button ps-btn ps-var-rename"><i class="fa-solid fa-i-cursor"></i> <span data-ps-i18n="vars_rename"></span></div>
                </div>
                <div class="ps-var-forms-title" data-ps-i18n="vars_forms_title"></div>
                <div class="ps-var-forms">${formRows}</div>
            `;
            localize(editor);
            const valueEl = editor.querySelector('.ps-var-value');
            valueEl.value = valueText(row.value);
            const setPreview = (text) => {
                const preview = el.querySelector('.ps-var-preview');
                if (preview) preview.textContent = text;
            };
            const saveValue = debounce(() => {
                setVariable(scopeApi, row.name, valueEl.value);
                setPreview(valueEl.value);
            }, 400);
            valueEl.addEventListener('input', saveValue);

            const bump = (delta) => {
                const current = valueEl.value.trim();
                const num = current === '' ? 0 : Number(current);
                if (!Number.isFinite(num)) {
                    toast()?.warning(t('vars_not_number'));
                    return;
                }
                const next = String(num + delta);
                valueEl.value = next;
                setVariable(scopeApi, row.name, next);
                setPreview(next);
            };
            editor.querySelector('.ps-var-inc').addEventListener('click', () => bump(1));
            editor.querySelector('.ps-var-dec').addEventListener('click', () => bump(-1));

            editor.querySelector('.ps-var-rename').addEventListener('click', async () => {
                const input = await callGenericPopup(t('vars_rename_prompt', { name: row.name }), POPUP_TYPE.INPUT ?? 3, row.name);
                const newName = typeof input === 'string' ? input.trim() : '';
                if (!newName || newName === row.name) return;
                if (!isValidName(newName)) {
                    toast()?.warning(t('vars_name_required'));
                    return;
                }
                const vars = getVariables();
                const bucket = row.scope === 'global' ? vars.global : vars.local;
                if (Object.hasOwn(bucket, newName)) {
                    toast()?.warning(t('vars_exists'));
                    return;
                }
                if (!setVariable(scopeApi, newName, valueEl.value)) {
                    toast()?.error(t('toast_error'));
                    return;
                }
                deleteVariable(scopeApi, row.name);
                expandedKey = `${row.scope}:${newName}`;
                toast()?.success(t('vars_renamed'));
                renderList();
            });

            for (const formRow of editor.querySelectorAll('.ps-var-form-row')) {
                const macro = formRow.dataset.macro;
                formRow.querySelector('.ps-var-form-insert').addEventListener('click', () => insertText(macro));
                formRow.querySelector('.ps-var-form-copy').addEventListener('click', () => copyText(macro));
            }
            el.appendChild(editor);
        }
        return el;
    };

    const renderList = () => {
        const query = searchValue.trim().toLowerCase();
        const rows = listAll();
        const visible = rows.filter(row =>
            (scopeFilter === 'all' || row.scope === scopeFilter) && matches(row, query));
        list.textContent = '';
        for (const row of visible) list.appendChild(varRow(row));
        if (!visible.length) {
            list.innerHTML = `<div class="ps-empty" data-ps-i18n="vars_empty"></div>`;
            localize(list);
        }
        countEl.textContent = t('vars_shown', { shown: visible.length, total: rows.length });
    };

    const renderListDebounced = debounce(renderList, 200);
    scopeEl.addEventListener('change', () => { scopeFilter = scopeEl.value; renderList(); });
    searchEl.addEventListener('input', () => { searchValue = searchEl.value; renderListDebounced(); });

    // --- create form ---
    const toggleForm = (show) => {
        formHost.style.display = show ? '' : 'none';
        if (!show) { formHost.textContent = ''; return; }
        formHost.innerHTML = `
            <input type="text" class="text_pole ps-vars-form-name ps-mono" data-ps-i18n="[placeholder]vars_name">
            <input type="text" class="text_pole ps-vars-form-value ps-mono" data-ps-i18n="[placeholder]vars_value">
            <select class="text_pole ps-vars-form-scope">
                <option value="chat" data-ps-i18n="vars_scope_chat"></option>
                <option value="global" data-ps-i18n="vars_scope_global"></option>
            </select>
            <div class="menu_button ps-btn ps-vars-form-create"><i class="fa-solid fa-check"></i> <span data-ps-i18n="vars_create"></span></div>
        `;
        localize(formHost);
        const scopeSel = formHost.querySelector('.ps-vars-form-scope');
        if (!hasOpenChat()) {
            scopeSel.value = 'global';
            scopeSel.querySelector('option[value="chat"]').disabled = true;
        }
        const create = () => {
            const name = formHost.querySelector('.ps-vars-form-name').value.trim();
            if (!isValidName(name)) {
                toast()?.warning(t('vars_name_required'));
                return;
            }
            const value = formHost.querySelector('.ps-vars-form-value').value;
            const scope = scopeSel.value === 'global' ? 'global' : 'local';
            if (!setVariable(scope, name, value)) {
                toast()?.error(t('toast_error'));
                return;
            }
            toast()?.success(t('vars_created'));
            toggleForm(false);
            // Reset filters so the new variable is visible, and open its editor.
            scopeFilter = 'all';
            scopeEl.value = 'all';
            searchValue = '';
            searchEl.value = '';
            expandedKey = `${scope === 'global' ? 'global' : 'chat'}:${name}`;
            renderList();
        };
        formHost.querySelector('.ps-vars-form-create').addEventListener('click', create);
        formHost.querySelector('.ps-vars-form-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
        formHost.querySelector('.ps-vars-form-value').addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
        formHost.querySelector('.ps-vars-form-name').focus();
    };
    body.querySelector('.ps-vars-new').addEventListener('click', () => {
        toggleForm(formHost.style.display === 'none');
    });

    renderList();
}

/**
 * Compact searchable picker used by the prompt editor: pick a macro form and
 * a variable, and the macro is inserted at the editor textarea's cursor.
 * @param {HTMLTextAreaElement} textarea
 */
export async function openVariablePicker(textarea) {
    const rows = listAll();
    const content = document.createElement('div');
    content.className = 'ps-varpick';
    content.innerHTML = `
        <div class="ps-varpick-top">
            <select class="text_pole ps-varpick-form">
                ${FORMS.map(form => `<option value="${form}" data-ps-i18n="vars_f_${form}"></option>`).join('')}
            </select>
            <input type="search" class="text_pole ps-varpick-search" data-ps-i18n="[placeholder]vars_search">
        </div>
        <div class="ps-varpick-list"></div>
    `;
    localize(content);
    const list = content.querySelector('.ps-varpick-list');
    const formEl = content.querySelector('.ps-varpick-form');
    const searchEl = content.querySelector('.ps-varpick-search');
    let popup = null;

    const renderRows = () => {
        const query = searchEl.value.trim().toLowerCase();
        list.textContent = '';
        for (const row of rows.filter(r => matches(r, query))) {
            const macro = buildVarMacro(formEl.value, row.scope, row.name);
            if (!macro) continue; // shorthand form with an incompatible name
            const el = document.createElement('div');
            el.className = 'ps-prow ps-varpick-row';
            el.innerHTML = `
                <span class="ps-badge ps-var-badge" data-ps-i18n="vars_badge_${row.scope}"></span>
                <code class="ps-var-name">${escapeHtml(row.name)}</code>
                <span class="ps-var-preview">${escapeHtml(valueText(row.value))}</span>
            `;
            localize(el);
            el.addEventListener('click', () => {
                insertAtCursor(textarea, macro);
                toast()?.success(t('block_inserted'));
                popup?.completeCancelled?.();
            });
            list.appendChild(el);
        }
        if (!list.children.length) {
            list.innerHTML = `<div class="ps-empty" data-ps-i18n="vars_empty"></div>`;
            localize(list);
        }
    };
    formEl.addEventListener('change', renderRows);
    searchEl.addEventListener('input', debounce(renderRows, 200));
    renderRows();

    try {
        popup = new Popup(content, POPUP_TYPE.TEXT, '', { okButton: t('cancel'), allowVerticalScrolling: true });
        await popup.show();
    } catch (err) {
        console.error(LOG, 'variable picker popup failed', err);
        await callGenericPopup(content, POPUP_TYPE.TEXT ?? 1, '', { okButton: t('cancel'), allowVerticalScrolling: true });
    }
}
