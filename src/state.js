// Settings: single source of truth in extension_settings[MODULE].
// Snapshots are keyed presetName -> promptIdentifier -> newest-first array so
// arbitrary characters in preset names can never collide with identifiers.

import { saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { hashContent } from './util.js';

export const MODULE = 'PromptStudio';

export const DEFAULTS = {
    schemaVersion: 1,
    language: 'ru',
    ui: {
        lastTab: 'prompts',   // prompts | regex | blocks | history | reference
        autocomplete: true,
        highlight: true,
        livePreview: true,
        autoSnapshot: true,
    },
    confirmRestore: true,
    hiddenMacros: [],         // macro names hidden from the Macros reference tab
    snapshots: {},            // { [presetName]: { [identifier]: [ entry ] } }
    snapshotCaps: { perPrompt: 20, totalEntries: 300, maxContentChars: 20000 },
    blocks: [],               // [ { id, name, content, createdTs } ]
    _seq: { snapshot: 0, block: 0 },
};

export function getSettings() {
    if (!extension_settings[MODULE]) extension_settings[MODULE] = structuredClone(DEFAULTS);
    const s = extension_settings[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = structuredClone(v);
    }
    for (const [k, v] of Object.entries(DEFAULTS.ui)) {
        if (s.ui[k] === undefined) s.ui[k] = v;
    }
    for (const [k, v] of Object.entries(DEFAULTS.snapshotCaps)) {
        if (typeof s.snapshotCaps[k] !== 'number') s.snapshotCaps[k] = v;
    }
    for (const [k, v] of Object.entries(DEFAULTS._seq)) {
        if (typeof s._seq[k] !== 'number') s._seq[k] = v;
    }
    return s;
}

export function save() {
    saveSettingsDebounced();
}

// --- Snapshots --------------------------------------------------------------

/** entry = { id, ts, name, role, content, hash, note?, truncated? } */
export function listSnapshots(presetName, identifier) {
    const s = getSettings();
    return s.snapshots[presetName]?.[identifier] ?? [];
}

export function listSnapshotPrompts(presetName) {
    const s = getSettings();
    return Object.keys(s.snapshots[presetName] ?? {});
}

/**
 * Store a snapshot (newest first). Returns the entry, or null when deduped
 * against the newest entry for that prompt. Oversized content is truncated
 * and flagged.
 */
export function addSnapshot(presetName, identifier, { name, role, content, note }) {
    const s = getSettings();
    const caps = s.snapshotCaps;
    let text = String(content ?? '');
    let truncated = false;
    if (text.length > caps.maxContentChars) {
        text = text.slice(0, caps.maxContentChars);
        truncated = true;
    }
    const hash = hashContent(String(role ?? ''), text);
    const bucket = ((s.snapshots[presetName] ??= {})[identifier] ??= []);
    if (bucket[0]?.hash === hash) return null;

    const entry = {
        id: `s${s._seq.snapshot++}`,
        ts: Date.now(),
        name: String(name ?? ''),
        role: String(role ?? 'system'),
        content: text,
        hash,
    };
    if (truncated) entry.truncated = true;
    if (note) entry.note = String(note);
    bucket.unshift(entry);
    if (bucket.length > caps.perPrompt) bucket.length = caps.perPrompt;
    pruneSnapshots();
    save();
    return entry;
}

export function deleteSnapshot(presetName, identifier, entryId) {
    const s = getSettings();
    const bucket = s.snapshots[presetName]?.[identifier];
    if (!bucket) return;
    const index = bucket.findIndex(e => e.id === entryId);
    if (index !== -1) bucket.splice(index, 1);
    if (bucket.length === 0) {
        delete s.snapshots[presetName][identifier];
        if (Object.keys(s.snapshots[presetName]).length === 0) delete s.snapshots[presetName];
    }
    save();
}

/** Global LRU prune: drop oldest entries beyond snapshotCaps.totalEntries. */
export function pruneSnapshots() {
    const s = getSettings();
    const all = [];
    for (const [preset, prompts] of Object.entries(s.snapshots)) {
        for (const [identifier, bucket] of Object.entries(prompts)) {
            for (const entry of bucket) all.push({ preset, identifier, entry });
        }
    }
    const excess = all.length - s.snapshotCaps.totalEntries;
    if (excess <= 0) return 0;
    all.sort((a, b) => a.entry.ts - b.entry.ts);
    for (const { preset, identifier, entry } of all.slice(0, excess)) {
        const bucket = s.snapshots[preset]?.[identifier];
        if (!bucket) continue;
        const index = bucket.indexOf(entry);
        if (index !== -1) bucket.splice(index, 1);
        if (bucket.length === 0) {
            delete s.snapshots[preset][identifier];
            if (Object.keys(s.snapshots[preset]).length === 0) delete s.snapshots[preset];
        }
    }
    return excess;
}

export function clearSnapshots() {
    const s = getSettings();
    s.snapshots = {};
    save();
}

export function countSnapshots() {
    const s = getSettings();
    let n = 0;
    for (const prompts of Object.values(s.snapshots)) {
        for (const bucket of Object.values(prompts)) n += bucket.length;
    }
    return n;
}

// --- Block library -----------------------------------------------------------

export function listBlocks() {
    return getSettings().blocks;
}

export function addBlock(name, content) {
    const s = getSettings();
    const block = {
        id: `b${s._seq.block++}`,
        name: String(name ?? '').trim(),
        content: String(content ?? ''),
        createdTs: Date.now(),
    };
    s.blocks.push(block);
    save();
    return block;
}

export function updateBlock(id, patch) {
    const s = getSettings();
    const block = s.blocks.find(b => b.id === id);
    if (!block) return null;
    if (typeof patch.name === 'string') block.name = patch.name.trim();
    if (typeof patch.content === 'string') block.content = patch.content;
    save();
    return block;
}

export function deleteBlock(id) {
    const s = getSettings();
    s.blocks = s.blocks.filter(b => b.id !== id);
    save();
}

// --- Export / import / reset --------------------------------------------------

export function buildExportPayload() {
    const s = getSettings();
    return {
        _type: MODULE,
        version: 1,
        snapshots: s.snapshots,
        blocks: s.blocks,
        snapshotCaps: s.snapshotCaps,
        hiddenMacros: s.hiddenMacros,
        _seq: s._seq,
    };
}

/** Throws on a malformed payload; never half-applies. */
export function applyImportPayload(data) {
    if (data?._type !== MODULE || typeof data.snapshots !== 'object' || !data.snapshots || !Array.isArray(data.blocks)) {
        throw new Error('bad payload');
    }
    const snapshots = {};
    for (const [preset, prompts] of Object.entries(data.snapshots)) {
        if (typeof prompts !== 'object' || !prompts) continue;
        for (const [identifier, bucket] of Object.entries(prompts)) {
            if (!Array.isArray(bucket)) continue;
            const clean = bucket
                .filter(e => e && typeof e === 'object' && typeof e.content === 'string')
                .map(e => ({
                    id: String(e.id ?? ''),
                    ts: Number(e.ts) || 0,
                    name: String(e.name ?? ''),
                    role: String(e.role ?? 'system'),
                    content: e.content,
                    hash: String(e.hash ?? hashContent(String(e.role ?? ''), e.content)),
                    ...(e.truncated ? { truncated: true } : {}),
                    ...(e.note ? { note: String(e.note) } : {}),
                }));
            if (clean.length) (snapshots[preset] ??= {})[identifier] = clean;
        }
    }
    const blocks = data.blocks
        .filter(b => b && typeof b === 'object' && typeof b.content === 'string')
        .map(b => ({
            id: String(b.id ?? ''),
            name: String(b.name ?? ''),
            content: b.content,
            createdTs: Number(b.createdTs) || 0,
        }));

    const s = getSettings();
    s.snapshots = snapshots;
    s.blocks = blocks;
    if (Array.isArray(data.hiddenMacros)) s.hiddenMacros = data.hiddenMacros.map(String);
    if (data.snapshotCaps && typeof data.snapshotCaps === 'object') {
        for (const k of Object.keys(DEFAULTS.snapshotCaps)) {
            if (typeof data.snapshotCaps[k] === 'number') s.snapshotCaps[k] = data.snapshotCaps[k];
        }
    }
    // Keep id counters ahead of every imported id so new ids never collide.
    const maxSeq = (items, prefix) => items.reduce((max, id) => {
        const n = id.startsWith(prefix) ? parseInt(id.slice(prefix.length), 10) : NaN;
        return Number.isFinite(n) ? Math.max(max, n + 1) : max;
    }, 0);
    const snapIds = Object.values(snapshots).flatMap(p => Object.values(p).flat()).map(e => e.id);
    s._seq.snapshot = Math.max(s._seq.snapshot, maxSeq(snapIds, 's'), Number(data._seq?.snapshot) || 0);
    s._seq.block = Math.max(s._seq.block, maxSeq(blocks.map(b => b.id), 'b'), Number(data._seq?.block) || 0);
    pruneSnapshots();
    save();
}

/**
 * Reset everything to defaults IN PLACE (references captured by listeners
 * must stay valid), preserving the UI language.
 */
export function resetAllData() {
    const s = getSettings();
    const keepLanguage = s.language;
    for (const [k, v] of Object.entries(DEFAULTS)) {
        s[k] = structuredClone(v);
    }
    s.language = keepLanguage;
    save();
}
