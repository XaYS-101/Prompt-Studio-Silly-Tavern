[English](README.md) | [Русский](README_ru.md)

---

# Prompt Studio

A SillyTavern extension for people who write, edit and test Chat Completion prompt presets. It replaces the cramped built-in Prompt Manager editing flow with a fullscreen studio: a big editor with macro autocomplete and highlighting, live preview with token counts, version history with diffs, a reusable block library, and a regex-script editor with a live tester.

**Your presets stay safe.** Exactly like the native Prompt Manager, edits apply to the running session first; the preset file on disk changes only when you press **Update preset file**. Version snapshots and blocks live in the extension's own settings and never touch ST's files. Remove the extension and everything is as it was.

**Heads up:** this is under active development. If something breaks, open the browser console, look for `[PS]` errors, and file an issue with the details.

---

## What it does

### The studio
A fullscreen editor over the current Chat Completion preset. Open it with the **Open Studio** button in the extension's settings (Extensions panel ➜ Prompt Studio).

On the left — the prompt list in its real order: enable checkboxes, role badges, token counts, up/down reordering and **drag & drop** (desktop). On the right — the editor for the selected prompt with every field the native form has (name, role, position, depth, order, triggers, forbid overrides).

The header shows which preset you are editing and a red **“not saved to preset”** badge as soon as the session state differs from the file on disk. One click on **Update preset file** writes it — through ST's own native update action.

### The editor
- **Macro autocomplete** — the same registry-driven autocomplete ST uses in its own prompt fields: type `{{` and get hints with descriptions and arguments.
- **Macro highlighting** — `{{macros}}` are tinted in the text; the variable family (`{{getvar}}`, `{{setvar}}`, …) gets its own colour, comments (`{{// …}}`) another, and macros not present in the registry are flagged red — typos show up instantly.
- **Live preview** — the prompt with all macros substituted against the currently open chat, plus a token count, updating as you type.
- **Dry run** — builds the complete prompt for the active chat (the exact message list ST would send to the API) without sending anything: every message with its role and token count, and the grand total.

### Two presets side by side
The **Two presets** tab puts the active preset next to any other Chat Completion preset: every prompt gets a status badge (same / differs / only in one of them), and clicking it opens both texts side by side. The left one edits the live preset as usual; the right one is written straight into the other preset's file (the active preset is never touched this way). Copy buttons move text in either direction, and an inline diff shows exactly what differs.

### Version history
A snapshot of the prompt is taken automatically before each editing session, and manually whenever you want (with a note). The History tab shows all snapshots of the current preset, filterable by prompt, with restore and delete. The **diff against the current text** shows exactly where and what changed: old/new line numbers, a +/−/~ summary, word-level highlights inside changed lines, folded runs of unchanged lines (click to expand) and name/role changes listed separately. Restoring first snapshots the current state, so it's always reversible. Limits (per prompt / total / max size), deduplication and a storage indicator keep `settings.json` from bloating.

### Block library
Reusable text fragments — standard instruction sections, disclaimers, style guides. Create a block from scratch or from selected text in the editor, then insert it at the cursor of any prompt in one click. Macros inside blocks work as usual.

### Variables manager
A dedicated tab for chat-local and global variables (the `{{getvar}}` / `{{setvar}}` family): create a variable with a name, value and scope (it opens right in the editor), rename it, edit values inline (auto-saved), nudge numeric values with **+1 / −1** buttons, delete with confirmation, search and filter by scope — built to stay usable with 50+ variables (compact rows, one scrollable list, a live counter). Each variable expands into a plain-language macro list — `{{getvar}}`, `{{setvar}}`, `{{addvar}}`, `{{incvar}}`, `{{decvar}}` and the `{{.name}}` / `{{$name}}` shorthands, each labelled with what it actually does — with one-click insert-at-cursor and copy. A collapsible "How variable macros work" primer covers the confusing parts: which macros output text and which don't, and nesting like `{{setvar::hp::{{roll:1d20}}}}`. In the prompt editor, a dedicated button opens a searchable picker that inserts the chosen macro form right at the cursor — and it also creates variables in place, marks the ones the prompt already references (sorted first), offers to create referenced-but-missing ones in one click, and can dump every variable as `name: {{getvar::name}}` lines for a state block.

### Macro & variable reference
A searchable, category-grouped catalogue of every macro your ST build actually registers (built from the live macro registry — extensions' custom macros show up too), with descriptions, arguments, aliases and examples. One click inserts the macro into the editor. Macros you never use can be hidden from the list with an eye button — a "Show hidden" toggle brings them back anytime. Below it — your current chat-local and global variables with their values and ready-made `{{getvar::…}}` insertion.

### Regex scripts
The Regex tab edits the global scripts of ST's built-in Regex extension with all their fields, and adds what the native editor lacks:
- a **validity indicator** for the find pattern,
- a **live tester** — paste a sample, see the matches highlighted and the result after replacement, computed by ST's own regex engine (so trim/macros/flags behave exactly like in production),
- a built-in **regex cheatsheet** (anchors, classes, quantifiers, groups, lookarounds, flags, and ST-specific fields explained),
- a **template library** — 36 ready-made scripts in a searchable catalogue, one click to add:
  - *Cleanup* (13): cut OOC comments, strip HTML, remove `<think>` blocks, collapse blank lines and double spaces, straighten curly quotes, remove asterisks / markdown headers / emoji, unwrap code fences, trim line ends, normalize ellipses;
  - *Formatting* (3): cut a leading `{{char}}:` name prefix (with macro substitution), «guillemets» for dialogue, em dash from `--`;
  - *Visuals* (18, display only): framed `Weather:` / `Location:` / `Time:` / `Inventory:` / `Quest:` lines, `Mood:` / HP / dice-roll pills, ` ```status ` stats panel, ` ```sms ` phone bubble, ` ```letter ` note sheet, `[System]` terminal box, `%%thoughts%%` and `((whisper))` styling, `||spoiler||` collapsible, scene dividers, chapter headers, 🎵 music lines;
  - *Prompt / token saving* (2, `promptOnly`): strip emoji from the prompt only, cut ` ```status ` blocks from older prompt messages.

  Visual templates use `markdownOnly`, so the stored chat text is never modified, and they are styled with ST theme variables so the frames match any theme.

Character-scoped and preset-scoped scripts are listed read-only.

### Odds and ends
- English and Russian interface (Russian by default; Auto follows ST's language).
- Export and import of the extension's data (snapshots, blocks, limits) as JSON.
- A **Clear all data** button that resets only the extension's own data. Presets, prompts and regex scripts are ST's and are left alone.

---

## Installation

In SillyTavern, go to **Extensions ➜ Install extension** and paste this repository URL:

```
https://github.com/XaYS-101/Prompt-Studio-Silly-Tavern
```

There's no server plugin and no `config.yaml` to edit. The extension runs entirely in the browser.

Built and tested on SillyTavern 1.17.0. On older versions the extension degrades gracefully: features whose APIs are missing (macro registry, autocomplete, regex engine) hide themselves instead of breaking.

---

## Notes

- The prompt editor works with **Chat Completion** presets (the Prompt Manager ones). Text Completion instruct/system-prompt templates are out of scope.
- Marker prompts (Chat History, Char Description, …) are structural placeholders: they can be toggled and reordered, but their content belongs to ST.
- The dry run needs an open chat with a character and a working Chat Completion connection — it uses ST's own dry-run generation pass.

## License

MIT
