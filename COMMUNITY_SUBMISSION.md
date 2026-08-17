# Daily Note Flow - Community Plugin Notes

## Plugin identity

- ID: `daily-note-flow`
- Display name: `Daily Note Flow`
- Minimum Obsidian version: `1.5.0`

## Current features

- Daily note capture in pure Markdown
- Daily tasks and todos
- Unified record input
- Automatic morning / afternoon / evening classification
- Record editing and deletion
- Weekly summary generation
- Monthly summary generation
- Weekly/monthly summary preview before applying
- Optional AI polishing for daily, weekly, and monthly summaries

## Data model

The plugin stores files directly inside the user's vault.

Default paths:

```text
Daliy_Note/Daily/2026-08-13.md
Daliy_Note/Weekly/2026-W33.md
Daliy_Note/Monthly/2026-08.md
```

Folder roles:

- `Daily`: daily notes
- `Weekly`: weekly summaries
- `Monthly`: monthly summaries

## AI configuration

AI polishing is optional.

Required settings:

- `DeepSeek API key`
- `AI base URL` default: `https://api.deepseek.com`
- `AI model` default: `deepseek-v4-flash`

Security note:

- The API key is stored locally in Obsidian plugin data.
- The key should never be committed to GitHub or shared publicly.
- If a legacy model value such as `deepseek-v3` is found, the plugin falls back to `deepseek-v4-flash`.

## Privacy

When AI polishing is enabled, the relevant Markdown content is sent to the configured DeepSeek endpoint.
If AI is not configured, the plugin still works for local Markdown capture and summary management.

## Release files

Each distributed release should include:

- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`
- `README.md`
