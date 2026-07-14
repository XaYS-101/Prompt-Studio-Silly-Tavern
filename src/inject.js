// Entry button above the native Prompt Manager. renderPromptManager() wipes
// #completion_prompt_manager.innerHTML on every render, so the button lives in
// the container's STATIC parent (.range-block in index.html) — no observer.

import { t, localize } from './i18n.js';
import { openStudio } from './ui-popup.js';

export function injectEntryButton() {
    const container = document.getElementById('completion_prompt_manager');
    const parent = container?.parentElement;
    if (!parent || document.getElementById('ps_pm_entry')) return;
    const bar = document.createElement('div');
    bar.className = 'ps-pm-toolbar';
    bar.innerHTML = `
        <div id="ps_pm_entry" class="menu_button ps-entry" data-ps-i18n="[title]entry_button_title">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            <span data-ps-i18n="open_studio"></span>
        </div>`;
    localize(bar);
    bar.querySelector('#ps_pm_entry').addEventListener('click', () => openStudio());
    parent.insertBefore(bar, container);
}
