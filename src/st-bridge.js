// The ONLY module that touches ST internals beyond the stable core
// (script.js / extensions.js / popup.js). Every deep import is dynamic and
// individually guarded; missing pieces flip a capability flag off instead of
// crashing the extension.

import { eventSource, event_types } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { LOG } from './util.js';

export const caps = {
    promptManager: false,   // openai.js promptManager + oai_settings
    autocomplete: false,    // MacroAutoComplete.setMacroAutoComplete
    macroRegistry: false,   // getContext().macros.registry
    tokens: false,          // getTokenCountAsync
    substitute: false,      // substituteParams
    dryRun: false,          // CHAT_COMPLETION_PROMPT_READY event exists
    regex: false,           // regex extension engine
    presetFile: false,      // #update_oai_preset native button
};

let openaiMod = null;
let macroAcMod = null;
let regexMod = null;
let utilsMod = null;

export async function initBridge() {
    const tryImport = async (path, label) => {
        try {
            return await import(path);
        } catch (err) {
            console.warn(LOG, `optional ST module unavailable: ${label}`, err);
            return null;
        }
    };

    openaiMod = await tryImport('../../../../openai.js', 'openai.js');
    macroAcMod = await tryImport('../../../../autocomplete/MacroAutoComplete.js', 'MacroAutoComplete.js');
    regexMod = await tryImport('../../../../extensions/regex/engine.js', 'regex/engine.js');
    utilsMod = await tryImport('../../../../utils.js', 'utils.js');

    const ctx = getContext();
    caps.promptManager = !!openaiMod?.oai_settings;
    caps.autocomplete = typeof macroAcMod?.setMacroAutoComplete === 'function';
    caps.macroRegistry = typeof ctx?.macros?.registry?.getAllMacros === 'function';
    caps.tokens = typeof ctx?.getTokenCountAsync === 'function';
    caps.substitute = typeof ctx?.substituteParams === 'function';
    caps.dryRun = !!event_types?.CHAT_COMPLETION_PROMPT_READY;
    caps.regex = typeof regexMod?.getScriptsByType === 'function' && typeof regexMod?.saveScriptsByType === 'function';
    caps.presetFile = !!document.getElementById('update_oai_preset');
    console.debug(LOG, 'bridge capabilities', { ...caps });
}

export function ctx() {
    return getContext();
}

// --- Prompt Manager ----------------------------------------------------------

/** Live binding — promptManager is assigned after openai settings load. */
export function pm() {
    return openaiMod?.promptManager ?? null;
}

export function oaiSettings() {
    return openaiMod?.oai_settings ?? null;
}

export function injectionPosition() {
    return openaiMod?.INJECTION_POSITION ?? { RELATIVE: 0, ABSOLUTE: 1 };
}

export function pmReady() {
    return !!(pm() && oaiSettings());
}

export function isCC() {
    const api = getContext()?.mainApi;
    return api === undefined ? pmReady() : api === 'openai';
}

export function currentPresetName() {
    return oaiSettings()?.preset_settings_openai ?? '';
}

/** null when the per-character order strategy has no character open. */
export function activeCharacter() {
    return pm()?.activeCharacter ?? null;
}

/**
 * Prompts in prompt_order order: [{ prompt, enabled }]. Marker prompts are
 * included (they toggle but do not edit).
 */
export function listOrderedPrompts() {
    const manager = pm();
    const character = activeCharacter();
    if (!manager || !character) return [];
    const order = manager.getPromptOrderForCharacter(character) ?? [];
    const out = [];
    for (const entry of order) {
        const prompt = manager.getPromptById(entry.identifier);
        if (prompt) out.push({ prompt, enabled: !!entry.enabled });
    }
    return out;
}

/** Prompts that exist in the preset but are not in the active order. */
export function listUnusedPrompts() {
    const manager = pm();
    const character = activeCharacter();
    if (!manager || !character) return [];
    const used = new Set((manager.getPromptOrderForCharacter(character) ?? []).map(e => e.identifier));
    return (oaiSettings()?.prompts ?? []).filter(p => p && !p.marker && !used.has(p.identifier));
}

export function getPromptById(identifier) {
    return pm()?.getPromptById(identifier) ?? null;
}

export const perms = {
    canEdit: (prompt) => !!prompt && pm()?.isPromptEditAllowed(prompt) === true,
    canToggle: (prompt) => !!prompt && pm()?.isPromptToggleAllowed(prompt) === true,
    canDelete: (prompt) => !!prompt && pm()?.isPromptDeletionAllowed(prompt) === true,
};

// selfWrite guard: our own saves re-emit SETTINGS_UPDATED; sync handlers must
// not treat them as external changes. Cleared on a macrotask so the debounced
// event handler still sees the flag.
let selfWriteDepth = 0;
export function isSelfWrite() {
    return selfWriteDepth > 0;
}

async function persist() {
    const manager = pm();
    if (!manager) return;
    selfWriteDepth++;
    try {
        manager.render(false);
        await manager.saveServiceSettings();
    } finally {
        setTimeout(() => { selfWriteDepth = Math.max(0, selfWriteDepth - 1); }, 300);
    }
}

export async function applyPromptPatch(identifier, patch) {
    const manager = pm();
    if (!manager) return false;
    manager.updatePromptByIdentifier(identifier, patch);
    await persist();
    return true;
}

export async function setPromptEnabled(identifier, enabled) {
    const manager = pm();
    const character = activeCharacter();
    if (!manager || !character) return false;
    const entry = manager.getPromptOrderEntry(character, identifier);
    if (!entry) return false;
    entry.enabled = !!enabled;
    await persist();
    return true;
}

/** dir: -1 up, +1 down. */
export async function movePrompt(identifier, dir) {
    const manager = pm();
    const character = activeCharacter();
    if (!manager || !character) return false;
    const order = manager.getPromptOrderForCharacter(character) ?? [];
    const index = order.findIndex(e => e.identifier === identifier);
    const target = index + dir;
    if (index === -1 || target < 0 || target >= order.length) return false;
    [order[index], order[target]] = [order[target], order[index]];
    await persist();
    return true;
}

export async function createPrompt({ name, role = 'system', content = '' }) {
    const manager = pm();
    const character = activeCharacter();
    if (!manager) return null;
    const identifier = newUuid();
    manager.addPrompt({ identifier, name, role, content }, identifier);
    const prompt = manager.getPromptById(identifier);
    if (prompt && character) manager.appendPrompt(prompt, character);
    await persist();
    return identifier;
}

/** Put an existing (unused) prompt back into the active order. */
export async function attachPrompt(identifier) {
    const manager = pm();
    const character = activeCharacter();
    const prompt = manager?.getPromptById(identifier);
    if (!manager || !character || !prompt) return false;
    manager.appendPrompt(prompt, character);
    await persist();
    return true;
}

export async function detachPrompt(identifier) {
    const manager = pm();
    const character = activeCharacter();
    const prompt = manager?.getPromptById(identifier);
    if (!manager || !character || !prompt) return false;
    manager.detachPrompt(prompt, character);
    await persist();
    return true;
}

export async function deletePrompt(identifier) {
    const manager = pm();
    const prompt = manager?.getPromptById(identifier);
    if (!manager || !prompt || !perms.canDelete(prompt)) return false;
    const character = activeCharacter();
    if (character) manager.detachPrompt(prompt, character);
    const index = manager.getPromptIndexById(identifier);
    if (index !== null && index !== -1) manager.serviceSettings.prompts.splice(Number(index), 1);
    await persist();
    return true;
}

/**
 * Write current settings into the preset file on disk through ST's own
 * "Update current preset" button (saveOpenAIPreset is not exported).
 */
export function updatePresetFile() {
    const button = document.getElementById('update_oai_preset');
    if (!button) return false;
    selfWriteDepth++;
    try {
        button.click();
    } finally {
        setTimeout(() => { selfWriteDepth = Math.max(0, selfWriteDepth - 1); }, 1000);
    }
    return true;
}

export function hasOpenCharacter() {
    const context = getContext();
    return context?.characterId !== undefined && !!context?.characters?.[context.characterId];
}

/**
 * Trigger a dry-run generation and resolve with the built chat, or null on
 * timeout/failure. The CHAT_COMPLETION_PROMPT_READY listener races tryGenerate.
 */
export function dryRunPreset(timeoutMs = 20000) {
    const manager = pm();
    if (!manager || !caps.dryRun) return Promise.resolve(null);
    return new Promise((resolve) => {
        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            eventSource.removeListener?.(event_types.CHAT_COMPLETION_PROMPT_READY, onReady);
            clearTimeout(timer);
            resolve(value);
        };
        const onReady = (data) => {
            if (data?.dryRun) finish({ chat: Array.isArray(data.chat) ? data.chat : [] });
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onReady);
        Promise.resolve()
            .then(() => manager.tryGenerate())
            .catch((err) => {
                console.error(LOG, 'dry run failed', err);
                finish(null);
            });
    });
}

let uuidFallbackCounter = 0;
export function newUuid() {
    if (typeof utilsMod?.uuidv4 === 'function') return utilsMod.uuidv4();
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `ps-${(uuidFallbackCounter++).toString(36)}-${performance.now().toString(36).replace('.', '')}`;
}

// --- Macros / tokens ----------------------------------------------------------

export function getAllMacros() {
    try {
        return ctx()?.macros?.registry?.getAllMacros?.({ excludeHiddenAliases: true }) ?? [];
    } catch (err) {
        console.error(LOG, 'getAllMacros failed', err);
        return [];
    }
}

export function attachAutocomplete(textarea) {
    if (!caps.autocomplete) return null;
    try {
        return macroAcMod.setMacroAutoComplete(textarea, { autocompleteMode: 'always', autocompleteStyle: 'expanded' });
    } catch (err) {
        console.error(LOG, 'setMacroAutoComplete failed', err);
        return null;
    }
}

export function substitute(text) {
    if (!caps.substitute) return String(text ?? '');
    try {
        return String(ctx().substituteParams(String(text ?? '')));
    } catch (err) {
        console.error(LOG, 'substituteParams failed', err);
        return String(text ?? '');
    }
}

export async function countTokens(text) {
    if (!caps.tokens) return null;
    try {
        return await ctx().getTokenCountAsync(String(text ?? ''));
    } catch (err) {
        console.error(LOG, 'getTokenCountAsync failed', err);
        return null;
    }
}

export function getVariables() {
    const context = ctx();
    const local = context?.chatMetadata?.variables;
    const global = context?.extensionSettings?.variables?.global;
    return {
        local: (local && typeof local === 'object') ? local : {},
        global: (global && typeof global === 'object') ? global : {},
    };
}

// --- Regex engine ---------------------------------------------------------------

export function regexEnums() {
    return {
        SCRIPT_TYPES: regexMod?.SCRIPT_TYPES ?? { GLOBAL: 0, SCOPED: 1, PRESET: 2 },
        placement: regexMod?.regex_placement ?? { USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, WORLD_INFO: 5, REASONING: 6 },
        substituteMode: regexMod?.substitute_find_regex ?? { NONE: 0, RAW: 1, ESCAPED: 2 },
    };
}

export function listRegexScripts(type) {
    if (!caps.regex) return [];
    try {
        return regexMod.getScriptsByType(type, { allowedOnly: false }) ?? [];
    } catch (err) {
        console.error(LOG, 'getScriptsByType failed', err);
        return [];
    }
}

export async function saveGlobalRegexScripts(scripts) {
    if (!caps.regex) return false;
    selfWriteDepth++;
    try {
        await regexMod.saveScriptsByType(scripts, regexEnums().SCRIPT_TYPES.GLOBAL);
        return true;
    } catch (err) {
        console.error(LOG, 'saveScriptsByType failed', err);
        return false;
    } finally {
        setTimeout(() => { selfWriteDepth = Math.max(0, selfWriteDepth - 1); }, 300);
    }
}

export function runRegex(script, sample) {
    if (!caps.regex) return sample;
    try {
        return regexMod.runRegexScript(structuredClone(script), sample);
    } catch (err) {
        console.error(LOG, 'runRegexScript failed', err);
        return sample;
    }
}

/** Parses ST's "/pattern/flags" form; undefined = invalid. */
export function parseRegex(findRegex) {
    try {
        return utilsMod?.regexFromString?.(findRegex);
    } catch {
        return undefined;
    }
}
