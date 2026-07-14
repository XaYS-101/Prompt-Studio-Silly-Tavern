// Prompt Studio — entry point.
// Client-only extension: a comfortable editor for Chat Completion prompt
// presets (list/order/toggles, big editor with macro autocomplete, highlight,
// live preview, version snapshots, block library) plus a regex-script editor
// with a live tester and cheatsheet.

import { eventSource, event_types } from '../../../../script.js';
import { LOG } from './src/util.js';
import { t } from './src/i18n.js';
import { getSettings } from './src/state.js';
import { initBridge, caps } from './src/st-bridge.js';
import { mountSettingsPanel } from './src/settings-panel.js';
import { injectEntryButton } from './src/inject.js';

async function init() {
    try {
        getSettings();
        await initBridge();
        mountSettingsPanel();

        if (!caps.promptManager) {
            console.error(LOG, 'prompt manager APIs are missing');
            globalThis.toastr?.warning(t('st_incompatible'));
        }

        injectEntryButton();
        // The button lives in a static parent, but re-check after preset
        // switches in case another extension rebuilt that part of the DOM.
        if (event_types?.OAI_PRESET_CHANGED_AFTER) {
            eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => injectEntryButton());
        }

        console.log(LOG, 'initialized');
    } catch (err) {
        console.error(LOG, 'init failed', err);
    }
}

jQuery(async () => {
    let started = false;
    const start = () => {
        if (started) return;
        started = true;
        init();
    };
    if (event_types?.APP_READY) {
        eventSource.on(event_types.APP_READY, start);
        // Fallback in case APP_READY already fired or never comes.
        setTimeout(start, 1500);
    } else {
        setTimeout(start, 800);
    }
});
