// Regex tab: global regex scripts of the built-in Regex extension — list,
// editor, validity indicator, live tester and a syntax cheatsheet. Scoped
// (character) and preset scripts are listed read-only.

import { callGenericPopup, POPUP_TYPE, POPUP_RESULT, Popup } from '../../../../popup.js';
import { t, localize, getLang } from './i18n.js';
import { LOG, escapeHtml, debounce } from './util.js';
import {
    caps, regexEnums, listRegexScripts, saveGlobalRegexScripts, runRegex, parseRegex, newUuid,
} from './st-bridge.js';

const toast = () => globalThis.toastr;

let selectedId = null;
let sample = '';

const PLACEMENTS = [
    { key: 'rx_pl_user', field: 'USER_INPUT' },
    { key: 'rx_pl_ai', field: 'AI_OUTPUT' },
    { key: 'rx_pl_slash', field: 'SLASH_COMMAND' },
    { key: 'rx_pl_wi', field: 'WORLD_INFO' },
    { key: 'rx_pl_reason', field: 'REASONING' },
];

const CHEATSHEET = ['anchors', 'classes', 'quant', 'groups', 'look', 'flags', 'st'];

// ---------------------------------------------------------------------------
// Template library. Visual templates are markdownOnly: they restyle the
// rendered message and never touch the stored chat text; their styles are
// built on ST theme variables so the boxes match any user theme. Names and
// descriptions are inline {en,ru} (data catalog, same pattern as the macro
// fallback list in ui-reference.js).
// ---------------------------------------------------------------------------
const FRAME_STYLE = 'border:1px solid var(--SmartThemeBorderColor);border-left:3px solid var(--SmartThemeQuoteColor);border-radius:8px;padding:6px 12px;margin:6px 0;background-color:var(--SmartThemeBlurTintColor);';
const PILL_STYLE = 'display:inline-block;border:1px solid var(--SmartThemeBorderColor);border-radius:999px;padding:1px 10px;margin:2px 6px 2px 0;background-color:var(--SmartThemeBlurTintColor);';
const MONO_STYLE = 'font-family:monospace;font-size:.95em;border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:6px 10px;margin:6px 0;background-color:rgba(0,0,0,.25);';
const NOTE_STYLE = 'font-style:italic;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:10px 14px;margin:6px 0;background-color:var(--SmartThemeBlurTintColor);white-space:pre-wrap;';
const BUBBLE_STYLE = 'display:inline-block;border:1px solid var(--SmartThemeBorderColor);border-radius:14px;padding:8px 12px;margin:6px 0;max-width:75%;background-color:var(--SmartThemeBlurTintColor);white-space:pre-wrap;';

const GROUPS = [
    { key: 'clean', label: 'rx_tpl_group_clean' },
    { key: 'format', label: 'rx_tpl_group_format' },
    { key: 'visual', label: 'rx_tpl_group_visual' },
    { key: 'prompt', label: 'rx_tpl_group_prompt' },
];

const TEMPLATES = [
    // -- cleanup (edits the stored message text) --
    {
        key: 'ooc', group: 'clean',
        name: { en: 'Cut OOC comments (OOC: …)', ru: 'Вырезать OOC-комментарии (OOC: …)' },
        desc: { en: 'Removes (OOC: …) asides from messages — Latin and Cyrillic, any case.', ru: 'Убирает вставки (OOC: …) из сообщений — латиница и кириллица, любой регистр.' },
        findRegex: '/\\s*\\(\\s*(?:OOC|ООС)\\s*:[^)]*\\)/gi',
        replaceString: '',
        placement: ['AI_OUTPUT', 'USER_INPUT'],
    },
    {
        key: 'html', group: 'clean',
        name: { en: 'Strip all HTML', ru: 'Вырезать весь HTML' },
        desc: { en: 'Deletes every HTML tag and comment; stray < signs are kept intact.', ru: 'Удаляет все HTML-теги и комментарии; одиночные знаки < не трогает.' },
        findRegex: '/<\\/?[a-zA-Z][^>]*>|<!--[\\s\\S]*?-->/g',
        replaceString: '',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'think', group: 'clean',
        name: { en: 'Cut <think> blocks', ru: 'Вырезать блоки <think>' },
        desc: { en: 'Cuts <think>/<thinking> reasoning blocks some models leak into replies.', ru: 'Вырезает блоки <think>/<thinking>, которые модели иногда оставляют в ответе.' },
        findRegex: '/<think(?:ing)?>[\\s\\S]*?<\\/think(?:ing)?>\\s*/gi',
        replaceString: '',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'blank', group: 'clean',
        name: { en: 'Collapse blank lines', ru: 'Схлопнуть пустые строки' },
        desc: { en: 'Collapses 3+ consecutive line breaks into a single empty line.', ru: 'Схлопывает 3+ переводов строки подряд в одну пустую строку.' },
        findRegex: '/\\n{3,}/g',
        replaceString: '\n\n',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'quotes', group: 'clean',
        name: { en: 'Straighten double quotes', ru: 'Прямые двойные кавычки' },
        desc: { en: 'Replaces curly double quotes (“ ” „) with straight ones.', ru: 'Заменяет «умные» двойные кавычки (“ ” „) на прямые.' },
        findRegex: '/[“”„]/g',
        replaceString: '"',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'quotes_single', group: 'clean',
        name: { en: 'Straighten single quotes', ru: 'Прямые одинарные кавычки' },
        desc: { en: 'Replaces curly single quotes and apostrophes (‘ ’ ‚) with straight ones.', ru: 'Заменяет «умные» одинарные кавычки и апострофы (‘ ’ ‚) на прямые.' },
        findRegex: '/[‘’‚]/g',
        replaceString: "'",
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'spaces', group: 'clean',
        name: { en: 'Collapse double spaces', ru: 'Убрать двойные пробелы' },
        desc: { en: 'Collapses runs of spaces inside a line to one; indentation is preserved.', ru: 'Сжимает подряд идущие пробелы внутри строки до одного; отступы не трогает.' },
        findRegex: '/(?<=\\S) {2,}(?=\\S)/g',
        replaceString: ' ',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'trail_ws', group: 'clean',
        name: { en: 'Trim line-end whitespace', ru: 'Убрать пробелы в конце строк' },
        desc: { en: 'Trims trailing spaces and tabs at line ends.', ru: 'Убирает пробелы и табы в конце строк.' },
        findRegex: '/[ \\t]+$/gm',
        replaceString: '',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'asterisks', group: 'clean',
        name: { en: 'Remove all asterisks', ru: 'Убрать все звёздочки' },
        desc: { en: 'Deletes all asterisks — removes *actions* and **bold** markup entirely.', ru: 'Удаляет все звёздочки — полностью снимает разметку *действий* и **жирного**.' },
        findRegex: '/\\*+/g',
        replaceString: '',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'headers', group: 'clean',
        name: { en: 'Remove markdown headers', ru: 'Убрать markdown-заголовки' },
        desc: { en: 'Strips markdown # header markers at line starts.', ru: 'Убирает маркеры заголовков # в начале строк.' },
        findRegex: '/^#{1,6}\\s+/gm',
        replaceString: '',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'fences', group: 'clean',
        name: { en: 'Unwrap code fences', ru: 'Распаковать кодовые блоки' },
        desc: { en: 'Unwraps ``` code fences, keeping their content.', ru: 'Снимает обёртку ``` кодовых блоков, оставляя содержимое.' },
        findRegex: '/```[a-zA-Z0-9]*\\n?([\\s\\S]*?)```/g',
        replaceString: '$1',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'dots', group: 'clean',
        name: { en: 'Normalize ellipses', ru: 'Нормализовать многоточия' },
        desc: { en: 'Normalizes 4+ dots in a row to a three-dot ellipsis.', ru: 'Приводит 4 и более точек подряд к обычному троеточию.' },
        findRegex: '/\\.{4,}/g',
        replaceString: '...',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'emoji', group: 'clean',
        name: { en: 'Remove emoji', ru: 'Убрать эмодзи' },
        desc: { en: 'Deletes emoji and pictographs from messages.', ru: 'Удаляет эмодзи и пиктограммы из сообщений.' },
        findRegex: '/[\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\u200D\\uFE0F]/gu',
        replaceString: '',
        placement: ['AI_OUTPUT'],
    },
    // -- formatting --
    {
        key: 'charname', group: 'format',
        name: { en: 'Cut “{{char}}:” prefix', ru: 'Срезать префикс «{{char}}:»' },
        desc: { en: 'Cuts a leading “Name:” prefix; the {{char}} macro substitutes the current character.', ru: 'Срезает префикс «Имя:» в начале строк; макрос {{char}} подставляет текущего персонажа.' },
        findRegex: '/^\\s*{{char}}\\s*:\\s*/gm',
        replaceString: '',
        placement: ['AI_OUTPUT'],
        substitute: 'ESCAPED',
    },
    {
        key: 'ru_quotes', group: 'format',
        name: { en: 'Guillemets « » for dialogue', ru: 'Кавычки-«ёлочки» в диалогах' },
        desc: { en: 'Turns "straight quotes" into «guillemets» (Russian typography).', ru: 'Превращает "прямые кавычки" в «ёлочки» (русская типографика).' },
        findRegex: '/"([^"\\n]+)"/g',
        replaceString: '«$1»',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'emdash', group: 'format',
        name: { en: 'Em dash from --', ru: 'Тире вместо --' },
        desc: { en: 'Replaces a standalone double hyphen -- with an em dash —.', ru: 'Заменяет одиночный двойной дефис -- на тире —.' },
        findRegex: '/(?<!-)--(?!-)/g',
        replaceString: '—',
        placement: ['AI_OUTPUT'],
    },
    // -- visuals (markdownOnly: display formatting only) --
    {
        key: 'weather', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '“Weather:” in a frame', ru: '«Погода:» в рамке' },
        desc: { en: 'A “Weather: …” line becomes a framed box with 🌤️.', ru: 'Строка «Weather:/Погода: …» превращается в рамку с 🌤️.' },
        findRegex: '/^\\s*(?:weather|погода)\\s*:\\s*(.+)$/gim',
        replaceString: `<div style="${FRAME_STYLE}">🌤️ <b>$1</b></div>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'location', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '“Location:” in a frame', ru: '«Локация:» в рамке' },
        desc: { en: 'A “Location: …” line becomes a framed box with 📍.', ru: 'Строка «Location:/Локация:/Место: …» превращается в рамку с 📍.' },
        findRegex: '/^\\s*(?:location|локация|место)\\s*:\\s*(.+)$/gim',
        replaceString: `<div style="${FRAME_STYLE}">📍 <b>$1</b></div>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'time', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '“Time:” in a frame', ru: '«Время:» в рамке' },
        desc: { en: 'A “Time: …” / “Date: …” line becomes a framed box with 🕒.', ru: 'Строка «Time:/Время:/Дата: …» превращается в рамку с 🕒.' },
        findRegex: '/^\\s*(?:time|время|дата)\\s*:\\s*(.+)$/gim',
        replaceString: `<div style="${FRAME_STYLE}">🕒 <b>$1</b></div>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'mood', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '“Mood:” as a pill', ru: '«Настроение:» плашкой' },
        desc: { en: 'A “Mood: …” line becomes a compact pill with 💭.', ru: 'Строка «Mood:/Настроение:/Эмоция: …» превращается в компактную плашку с 💭.' },
        findRegex: '/^\\s*(?:mood|настроение|эмоция)\\s*:\\s*(.+)$/gim',
        replaceString: `<span style="${PILL_STYLE}">💭 $1</span>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'hp', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: 'HP as a pill', ru: 'HP/здоровье плашкой' },
        desc: { en: 'An “HP: 7/10” line becomes a pill with ❤️.', ru: 'Строка «HP:/ХП:/Здоровье: 7/10» превращается в плашку с ❤️.' },
        findRegex: '/^\\s*(?:HP|ХП|здоровье)\\s*:\\s*(\\d+\\s*\\/\\s*\\d+)\\s*$/gim',
        replaceString: `<span style="${PILL_STYLE}">❤️ <b>$1</b></span>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'dice', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: 'Dice roll badge', ru: 'Бейдж броска кубика' },
        desc: { en: '“roll: 17” becomes a 🎲 badge with the number.', ru: '«roll: 17» / «бросок: 17» превращается в бейдж 🎲 с числом.' },
        findRegex: '/(?:\\broll|бросок)\\s*:\\s*(\\d+)/gi',
        replaceString: `<span style="${PILL_STYLE}">🎲 <b>$1</b></span>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'inventory', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '“Inventory:” in a frame', ru: '«Инвентарь:» в рамке' },
        desc: { en: 'An “Inventory: …” line becomes a framed box with 🎒.', ru: 'Строка «Inventory:/Инвентарь: …» превращается в рамку с 🎒.' },
        findRegex: '/^\\s*(?:inventory|инвентарь)\\s*:\\s*(.+)$/gim',
        replaceString: `<div style="${FRAME_STYLE}">🎒 $1</div>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'quest', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '“Quest:” in a frame', ru: '«Задание:» в рамке' },
        desc: { en: 'A “Quest: …” / “Goal: …” line becomes a framed box with 📜.', ru: 'Строка «Quest:/Задание:/Цель: …» превращается в рамку с 📜.' },
        findRegex: '/^\\s*(?:quest|задание|цель)\\s*:\\s*(.+)$/gim',
        replaceString: `<div style="${FRAME_STYLE}">📜 <b>$1</b></div>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'status', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '```status as a panel', ru: 'Блок ```status как панель' },
        desc: { en: 'A ```status code block renders as a stats panel, line breaks kept.', ru: 'Кодовый блок ```status отображается панелью статов с сохранением переносов.' },
        findRegex: '/```status\\s*\\n([\\s\\S]*?)\\n?```/gi',
        replaceString: `<div style="${FRAME_STYLE}white-space:pre-wrap;">📊\n$1</div>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'system', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '[System] terminal box', ru: '[Система] терминальной плашкой' },
        desc: { en: 'Lines like “[System] …” render as a terminal-style monospace box.', ru: 'Строки вида «[System]/[Система] …» рисуются моноширинной «терминальной» плашкой.' },
        findRegex: '/^\\[(?:System|Система)\\]\\s*(.+)$/gim',
        replaceString: `<div style="${MONO_STYLE}">🖥️ $1</div>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'sms', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '```sms as a phone bubble', ru: '```sms пузырём сообщения' },
        desc: { en: 'A ```sms code block renders as a phone message bubble.', ru: 'Кодовый блок ```sms отображается пузырём телефонного сообщения.' },
        findRegex: '/```sms\\s*\\n([\\s\\S]*?)\\n?```/gi',
        replaceString: `<div style="${BUBBLE_STYLE}">📱 $1</div>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'letter', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '```letter as a note', ru: '```letter листом письма' },
        desc: { en: 'A ```letter code block renders as an italic letter/note sheet.', ru: 'Кодовый блок ```letter отображается «листом письма» с курсивом.' },
        findRegex: '/```letter\\s*\\n([\\s\\S]*?)\\n?```/gi',
        replaceString: `<div style="${NOTE_STYLE}">✉️\n$1</div>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'thought', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '%%thoughts%% faded', ru: '%%мысли%% приглушённо' },
        desc: { en: 'Text wrapped in %%…%% shows as a faded italic inner thought.', ru: 'Текст в %%…%% показывается приглушённой курсивной «мыслью».' },
        findRegex: '/%%([\\s\\S]+?)%%/g',
        replaceString: '<span style="opacity:.65;font-style:italic;">💭 $1</span>',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'whisper', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '((whisper)) small text', ru: '((шёпот)) мелким текстом' },
        desc: { en: 'Text wrapped in ((…)) shows small and faded, like a whisper.', ru: 'Текст в ((…)) показывается мелким и приглушённым, как шёпот.' },
        findRegex: '/\\(\\(([\\s\\S]+?)\\)\\)/g',
        replaceString: '<span style="opacity:.6;font-size:.9em;">$1</span>',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'music', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '“Music:” as a 🎵 line', ru: '«Музыка:» строкой с 🎵' },
        desc: { en: 'A “Music: …” line becomes an italic 🎵 line.', ru: 'Строка «Music:/Музыка: …» превращается в курсивную строку с 🎵.' },
        findRegex: '/^\\s*(?:music|музыка)\\s*:\\s*(.+)$/gim',
        replaceString: '<span style="font-style:italic;opacity:.85;">🎵 $1</span>',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'spoiler', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '||spoiler|| collapsible', ru: '||спойлер|| раскрывашкой' },
        desc: { en: '||text|| becomes a click-to-reveal collapsible.', ru: '||текст|| превращается в раскрывашку по клику.' },
        findRegex: '/\\|\\|([\\s\\S]+?)\\|\\|/g',
        replaceString: () => `<details><summary>${t('rx_spoiler_summary')}</summary>$1</details>`,
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'divider', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: 'Fancy scene divider', ru: 'Красивый разделитель сцен' },
        desc: { en: 'A line of *** or ---- renders as a neat theme-colored divider.', ru: 'Строка из *** или ---- рисуется аккуратным разделителем в цветах темы.' },
        findRegex: '/^\\s*(?:\\*{3,}|-{4,})\\s*$/gm',
        replaceString: '<hr style="border:none;border-top:2px solid var(--SmartThemeQuoteColor);opacity:.5;margin:12px 15%;">',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'chapter', group: 'visual', markdownOnly: true, runOnEdit: true,
        name: { en: '“Chapter” header', ru: 'Заголовок «Глава»' },
        desc: { en: 'A “Chapter …” line renders as a big header with an underline.', ru: 'Строка «Chapter/Глава …» рисуется крупным заголовком с подчёркиванием.' },
        findRegex: '/^\\s*((?:chapter|глава)\\s+.+)$/gim',
        replaceString: '<div style="font-size:1.15em;font-weight:700;border-bottom:2px solid var(--SmartThemeQuoteColor);padding-bottom:4px;margin:10px 0 6px;">$1</div>',
        placement: ['AI_OUTPUT'],
    },
    // -- prompt-side (promptOnly: what the model receives, not what you see) --
    {
        key: 'emoji_prompt', group: 'prompt', promptOnly: true,
        name: { en: 'Emoji out of the prompt', ru: 'Эмодзи не в промпт' },
        desc: { en: 'Emoji stay visible in chat but are stripped from the prompt sent to the model.', ru: 'Эмодзи остаются в чате, но вырезаются из промпта, уходящего модели.' },
        findRegex: '/[\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\u200D\\uFE0F]/gu',
        replaceString: '',
        placement: ['AI_OUTPUT'],
    },
    {
        key: 'status_prompt', group: 'prompt', promptOnly: true, minDepth: 1,
        name: { en: 'Old ```status out of the prompt', ru: 'Старые ```status не в промпт' },
        desc: { en: 'Cuts ```status blocks from older messages in the prompt; the newest message keeps its block. Saves tokens.', ru: 'Вырезает блоки ```status из старых сообщений в промпте; в последнем сообщении блок остаётся. Экономит токены.' },
        findRegex: '/```status\\s*\\n[\\s\\S]*?```\\s*/gi',
        replaceString: '',
        placement: ['AI_OUTPUT'],
    },
];

export async function renderRegexTab(body, nav) {
    if (!caps.regex) {
        body.innerHTML = `<div class="ps-note ps-note-warn" data-ps-i18n="rx_unavailable"></div>`;
        localize(body);
        return;
    }

    const enums = regexEnums();
    const scripts = structuredClone(listRegexScripts(enums.SCRIPT_TYPES.GLOBAL) ?? []);
    for (const script of scripts) {
        if (!script.id) script.id = newUuid();
    }
    if (selectedId && !scripts.some(s => s.id === selectedId)) selectedId = null;
    if (!selectedId && scripts.length) selectedId = scripts[0].id;

    body.innerHTML = `
        <div class="ps-regex">
            <div class="ps-rx-list">
                <div class="ps-plist-toolbar">
                    <div class="menu_button ps-btn ps-rx-new"><i class="fa-solid fa-plus"></i> <span data-ps-i18n="rx_new"></span></div>
                    <div class="menu_button ps-btn ps-rx-lib"><i class="fa-solid fa-book-open"></i> <span data-ps-i18n="rx_lib"></span></div>
                </div>
                <div class="ps-rx-items"></div>
                <div class="ps-rx-readonly"></div>
            </div>
            <div class="ps-rx-editor"></div>
        </div>
    `;
    localize(body);

    const items = body.querySelector('.ps-rx-items');
    const editorHost = body.querySelector('.ps-rx-editor');

    const persist = debounce(async () => {
        if (!await saveGlobalRegexScripts(structuredClone(scripts))) {
            toast()?.error(t('toast_error'));
        }
    }, 500);

    const renderRows = () => {
        items.textContent = '';
        if (!scripts.length) {
            items.innerHTML = `<div class="ps-empty" data-ps-i18n="rx_empty"></div>`;
            localize(items);
            return;
        }
        for (const script of scripts) {
            const row = document.createElement('div');
            row.className = 'ps-prow ps-rx-row';
            if (script.id === selectedId) row.classList.add('ps-prow-selected');
            if (script.disabled) row.classList.add('ps-prow-disabled');
            const valid = !script.findRegex || parseRegex(script.findRegex) !== undefined;
            row.innerHTML = `
                <div class="ps-prow-main">
                    <span class="ps-prow-name">${escapeHtml(script.scriptName || script.id)}</span>
                    ${valid ? '' : `<span class="ps-badge ps-badge-warn" data-ps-i18n="[title]rx_invalid">!</span>`}
                    ${script.disabled ? `<span class="ps-badge" data-ps-i18n="rx_disabled"></span>` : ''}
                </div>
            `;
            localize(row);
            row.addEventListener('click', () => {
                selectedId = script.id;
                renderRows();
                renderEditor();
            });
            items.appendChild(row);
        }
    };

    const renderReadonly = () => {
        const host = body.querySelector('.ps-rx-readonly');
        const scoped = listRegexScripts(enums.SCRIPT_TYPES.SCOPED);
        const preset = listRegexScripts(enums.SCRIPT_TYPES.PRESET);
        if (!scoped.length && !preset.length) return;
        host.innerHTML = `
            <div class="ps-note" data-ps-i18n="rx_scoped_note"></div>
            ${[...scoped, ...preset].map(s => `<div class="ps-prow ps-prow-readonly"><div class="ps-prow-main"><span class="ps-prow-name">${escapeHtml(s.scriptName || s.id || '')}</span></div></div>`).join('')}
        `;
        localize(host);
    };

    const renderEditor = () => {
        editorHost.textContent = '';
        const script = scripts.find(s => s.id === selectedId);
        if (!script) {
            editorHost.innerHTML = `<div class="ps-empty" data-ps-i18n="rx_empty"></div>`;
            localize(editorHost);
            renderCheatsheet(editorHost);
            return;
        }

        const wrap = document.createElement('div');
        wrap.className = 'ps-rx-form';
        wrap.innerHTML = `
            <div class="ps-ed-top">
                <input type="text" class="text_pole ps-rx-name" data-ps-i18n="[placeholder]rx_name" value="${escapeHtml(script.scriptName ?? '')}">
                <div class="menu_button ps-btn ps-danger ps-rx-delete" data-ps-i18n="[title]confirm_delete_rx"><i class="fa-solid fa-trash"></i></div>
            </div>
            <label class="ps-fld-block">
                <span data-ps-i18n="rx_find"></span> <span class="ps-rx-validity"></span>
                <input type="text" class="text_pole ps-rx-find ps-mono" value="${escapeHtml(script.findRegex ?? '')}" placeholder="/pattern/flags">
            </label>
            <label class="ps-fld-block">
                <span data-ps-i18n="rx_replace"></span>
                <textarea class="text_pole ps-rx-replace ps-mono" rows="2"></textarea>
                <small class="ps-muted" data-ps-i18n="rx_replace_hint"></small>
            </label>
            <label class="ps-fld-block">
                <span data-ps-i18n="rx_trim"></span>
                <textarea class="text_pole ps-rx-trim ps-mono" rows="2"></textarea>
            </label>
            <div class="ps-fld-block">
                <span data-ps-i18n="rx_placement"></span>
                <div class="ps-rx-placements">
                    ${PLACEMENTS.map(p => `
                        <label class="checkbox_label">
                            <input type="checkbox" class="ps-rx-pl" data-value="${enums.placement[p.field]}"
                                ${Array.isArray(script.placement) && script.placement.includes(enums.placement[p.field]) ? 'checked' : ''}>
                            <span data-ps-i18n="${p.key}"></span>
                        </label>`).join('')}
                </div>
            </div>
            <div class="ps-rx-flagrow">
                <label class="checkbox_label"><input type="checkbox" class="ps-rx-flag" data-field="disabled" ${script.disabled ? 'checked' : ''}><span data-ps-i18n="rx_disabled"></span></label>
                <label class="checkbox_label"><input type="checkbox" class="ps-rx-flag" data-field="markdownOnly" ${script.markdownOnly ? 'checked' : ''}><span data-ps-i18n="rx_md_only"></span></label>
                <label class="checkbox_label"><input type="checkbox" class="ps-rx-flag" data-field="promptOnly" ${script.promptOnly ? 'checked' : ''}><span data-ps-i18n="rx_prompt_only"></span></label>
                <label class="checkbox_label"><input type="checkbox" class="ps-rx-flag" data-field="runOnEdit" ${script.runOnEdit ? 'checked' : ''}><span data-ps-i18n="rx_run_on_edit"></span></label>
            </div>
            <div class="ps-rx-flagrow">
                <label class="ps-fld">
                    <span data-ps-i18n="rx_substitute"></span>
                    <select class="text_pole ps-rx-substitute">
                        <option value="${enums.substituteMode.NONE}" data-ps-i18n="rx_sub_none"></option>
                        <option value="${enums.substituteMode.RAW}" data-ps-i18n="rx_sub_raw"></option>
                        <option value="${enums.substituteMode.ESCAPED}" data-ps-i18n="rx_sub_escaped"></option>
                    </select>
                </label>
                <label class="ps-fld">
                    <span data-ps-i18n="rx_min_depth"></span>
                    <input type="number" class="text_pole ps-rx-mindepth" min="0" value="${escapeHtml(script.minDepth ?? '')}">
                </label>
                <label class="ps-fld">
                    <span data-ps-i18n="rx_max_depth"></span>
                    <input type="number" class="text_pole ps-rx-maxdepth" min="0" value="${escapeHtml(script.maxDepth ?? '')}">
                </label>
            </div>
            <div class="ps-rx-tester">
                <b data-ps-i18n="rx_tester_title"></b>
                <textarea class="text_pole ps-rx-sample ps-mono" rows="3" data-ps-i18n="[placeholder]rx_sample_placeholder"></textarea>
                <div class="ps-rx-matchinfo ps-muted"></div>
                <div class="ps-rx-highlight"></div>
                <span data-ps-i18n="rx_result"></span>
                <pre class="ps-rx-result"></pre>
            </div>
        `;
        localize(wrap);
        editorHost.appendChild(wrap);
        renderCheatsheet(editorHost);

        wrap.querySelector('.ps-rx-replace').value = script.replaceString ?? '';
        wrap.querySelector('.ps-rx-trim').value = Array.isArray(script.trimStrings) ? script.trimStrings.join('\n') : '';
        wrap.querySelector('.ps-rx-substitute').value = String(script.substituteRegex ?? enums.substituteMode.NONE);
        const sampleEl = wrap.querySelector('.ps-rx-sample');
        sampleEl.value = sample;

        const validityEl = wrap.querySelector('.ps-rx-validity');
        const updateValidity = () => {
            if (!script.findRegex) {
                validityEl.textContent = '';
                validityEl.className = 'ps-rx-validity';
                return;
            }
            const ok = parseRegex(script.findRegex) !== undefined;
            validityEl.textContent = ok ? '✓ ' + t('rx_valid') : '✗ ' + t('rx_invalid');
            validityEl.className = 'ps-rx-validity ' + (ok ? 'ps-ok' : 'ps-bad');
        };

        const matchInfo = wrap.querySelector('.ps-rx-matchinfo');
        const highlightEl = wrap.querySelector('.ps-rx-highlight');
        const resultEl = wrap.querySelector('.ps-rx-result');
        const updateTester = () => {
            sample = sampleEl.value;
            highlightEl.textContent = '';
            resultEl.textContent = '';
            matchInfo.textContent = '';
            if (!sample || !script.findRegex) return;
            const re = parseRegex(script.findRegex);
            if (re === undefined) {
                matchInfo.textContent = t('rx_invalid');
                return;
            }
            try {
                const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
                const matches = [...sample.matchAll(global)];
                matchInfo.textContent = matches.length ? t('rx_matches', { n: matches.length }) : t('rx_no_match');
                let html = '';
                let last = 0;
                for (const match of matches) {
                    if (match[0] === '') continue; // zero-length matches render nothing
                    html += escapeHtml(sample.slice(last, match.index));
                    html += `<mark>${escapeHtml(match[0])}</mark>`;
                    last = match.index + match[0].length;
                }
                html += escapeHtml(sample.slice(last));
                highlightEl.innerHTML = html;
                // The engine call is the source of truth for the final result.
                resultEl.textContent = runRegex({ ...structuredClone(script), disabled: false }, sample);
            } catch (err) {
                console.error(LOG, 'tester failed', err);
                matchInfo.textContent = t('rx_invalid');
            }
        };
        const updateTesterDebounced = debounce(updateTester, 300);

        const applyField = () => {
            script.scriptName = wrap.querySelector('.ps-rx-name').value;
            script.findRegex = wrap.querySelector('.ps-rx-find').value;
            script.replaceString = wrap.querySelector('.ps-rx-replace').value;
            script.trimStrings = wrap.querySelector('.ps-rx-trim').value.split('\n').filter(Boolean);
            script.placement = Array.from(wrap.querySelectorAll('.ps-rx-pl:checked')).map(el => Number(el.dataset.value));
            for (const flag of wrap.querySelectorAll('.ps-rx-flag')) script[flag.dataset.field] = flag.checked;
            script.substituteRegex = Number(wrap.querySelector('.ps-rx-substitute').value);
            const minDepth = wrap.querySelector('.ps-rx-mindepth').value;
            const maxDepth = wrap.querySelector('.ps-rx-maxdepth').value;
            script.minDepth = minDepth === '' ? null : Number(minDepth);
            script.maxDepth = maxDepth === '' ? null : Number(maxDepth);
            updateValidity();
            updateTesterDebounced();
            persist();
            // Keep the list label/badges in sync without a full rebuild.
            renderRows();
        };

        for (const el of wrap.querySelectorAll('.ps-rx-name, .ps-rx-find, .ps-rx-replace, .ps-rx-trim, .ps-rx-substitute, .ps-rx-mindepth, .ps-rx-maxdepth')) {
            el.addEventListener('input', applyField);
        }
        for (const el of wrap.querySelectorAll('.ps-rx-pl, .ps-rx-flag')) {
            el.addEventListener('change', applyField);
        }
        sampleEl.addEventListener('input', updateTesterDebounced);

        wrap.querySelector('.ps-rx-delete').addEventListener('click', async () => {
            const ok = await callGenericPopup(t('confirm_delete_rx'), POPUP_TYPE.CONFIRM ?? 2);
            if (ok !== (POPUP_RESULT?.AFFIRMATIVE ?? 1)) return;
            const index = scripts.findIndex(s => s.id === script.id);
            if (index !== -1) scripts.splice(index, 1);
            selectedId = scripts[0]?.id ?? null;
            persist();
            renderRows();
            renderEditor();
        });

        updateValidity();
        updateTester();
    };

    body.querySelector('.ps-rx-new').addEventListener('click', async () => {
        const name = await callGenericPopup(t('rx_name'), POPUP_TYPE.INPUT ?? 3, '');
        if (!name || typeof name !== 'string' || !name.trim()) return;
        const enumsLocal = regexEnums();
        const script = {
            id: newUuid(),
            scriptName: name.trim(),
            findRegex: '',
            replaceString: '',
            trimStrings: [],
            placement: [enumsLocal.placement.AI_OUTPUT],
            disabled: false,
            markdownOnly: false,
            promptOnly: false,
            runOnEdit: false,
            substituteRegex: enumsLocal.substituteMode.NONE,
            minDepth: null,
            maxDepth: null,
        };
        scripts.push(script);
        selectedId = script.id;
        persist();
        renderRows();
        renderEditor();
    });

    const lang = () => (getLang() === 'ru' ? 'ru' : 'en');

    const addTemplate = (tpl) => {
        const script = {
            id: newUuid(),
            scriptName: tpl.name[lang()],
            findRegex: tpl.findRegex,
            replaceString: typeof tpl.replaceString === 'function' ? tpl.replaceString() : tpl.replaceString,
            trimStrings: [],
            placement: tpl.placement.map(name => enums.placement[name]).filter(v => v !== undefined),
            disabled: false,
            markdownOnly: !!tpl.markdownOnly,
            promptOnly: !!tpl.promptOnly,
            runOnEdit: !!tpl.runOnEdit,
            substituteRegex: tpl.substitute !== undefined ? enums.substituteMode[tpl.substitute] : enums.substituteMode.NONE,
            minDepth: tpl.minDepth ?? null,
            maxDepth: tpl.maxDepth ?? null,
        };
        scripts.push(script);
        selectedId = script.id;
        persist();
        renderRows();
        renderEditor();
    };

    const openTemplateLibrary = async () => {
        const content = document.createElement('div');
        content.className = 'ps-rxlib';
        content.innerHTML = `
            <input type="text" class="text_pole ps-rxlib-search" data-ps-i18n="[placeholder]rx_lib_search">
            <div class="ps-rxlib-list"></div>
        `;
        const list = content.querySelector('.ps-rxlib-list');
        const renderList = (filter = '') => {
            const query = filter.trim().toLowerCase();
            list.textContent = '';
            for (const group of GROUPS) {
                const matches = TEMPLATES.filter(tpl => tpl.group === group.key && (!query ||
                    `${tpl.name.en} ${tpl.name.ru} ${tpl.desc.en} ${tpl.desc.ru}`.toLowerCase().includes(query)));
                if (!matches.length) continue;
                const section = document.createElement('div');
                section.className = 'ps-rxlib-group';
                section.innerHTML = `<b data-ps-i18n="${group.label}"></b>`;
                for (const tpl of matches) {
                    const row = document.createElement('div');
                    row.className = 'ps-rxlib-row';
                    row.innerHTML = `
                        <div class="ps-rxlib-info">
                            <div class="ps-rxlib-name">${escapeHtml(tpl.name[lang()])}</div>
                            <small class="ps-muted">${escapeHtml(tpl.desc[lang()])}</small>
                        </div>
                        <div class="menu_button ps-btn ps-rxlib-add" data-ps-i18n="[title]rx_lib_add"><i class="fa-solid fa-plus"></i></div>
                    `;
                    row.querySelector('.ps-rxlib-add').addEventListener('click', () => {
                        addTemplate(tpl);
                        toast()?.success(t('rx_tpl_added'));
                    });
                    section.appendChild(row);
                }
                list.appendChild(section);
            }
            if (!list.childElementCount) list.innerHTML = `<div class="ps-empty" data-ps-i18n="rx_lib_empty"></div>`;
            localize(list);
        };
        renderList();
        content.querySelector('.ps-rxlib-search').addEventListener('input', (e) => renderList(e.target.value));
        localize(content);
        try {
            const popup = new Popup(content, POPUP_TYPE.TEXT, '', { okButton: t('close'), wide: true, large: true, allowVerticalScrolling: true });
            await popup.show();
        } catch (err) {
            console.error(LOG, 'template library popup failed', err);
            await callGenericPopup(content, POPUP_TYPE.TEXT ?? 1, '', { okButton: t('close'), allowVerticalScrolling: true });
        }
    };

    body.querySelector('.ps-rx-lib').addEventListener('click', () => openTemplateLibrary());

    renderRows();
    renderReadonly();
    renderEditor();
}

function renderCheatsheet(host) {
    const details = document.createElement('details');
    details.className = 'ps-cheatsheet';
    details.innerHTML = `
        <summary data-ps-i18n="rx_cheatsheet_title"></summary>
        ${CHEATSHEET.map(section => `
            <div class="ps-cs-section">
                <b data-ps-i18n="cs_${section}_title"></b>
                <div class="ps-cs-body ps-mono" data-ps-i18n="cs_${section}_body"></div>
            </div>`).join('')}
    `;
    localize(details);
    host.appendChild(details);
}
