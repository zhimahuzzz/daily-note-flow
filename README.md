# Daily Note Flow

Daily Note Flow is an Obsidian plugin for capturing daily tasks, todos, time-based records, summaries, and weekly/monthly review notes in plain Markdown.

## What it does

- Stores all data as Markdown inside your Obsidian vault
- Supports a single daily note entry panel
- Adds and edits records with automatic morning / afternoon / evening classification
- Reorders records automatically after time edits
- Lets you edit or delete individual records
- Generates weekly and monthly summary Markdown files from daily notes
- Lets you preview weekly/monthly summaries before applying them
- Supports optional DeepSeek AI polishing for daily, weekly, and monthly summaries

## Storage

Default root folder inside your vault:

```text
Daliy_Note/
```

The plugin creates these subfolders:

```text
Daliy_Note/Daily/
Daliy_Note/Weekly/
Daliy_Note/Monthly/
```

Example paths:

```text
Daliy_Note/Daily/2026-08-13.md
Daliy_Note/Weekly/2026-W33.md
Daliy_Note/Monthly/2026-08.md
```

## Settings

- `Root folder`: where Daily Note Flow stores Markdown files
- `DeepSeek API key`: required only for AI summary polishing
- `AI base URL`: default `https://api.deepseek.com`
- `AI model`: default `deepseek-v4-flash`

## Important notes

- The plugin writes to files in your vault, not to a hidden database.
- If you enable AI polishing, note content is sent to the configured AI endpoint.
- API keys are stored locally in Obsidian plugin data and should not be committed to GitHub.
- Daily, weekly, and monthly notes are kept in separate folders so they remain easy to browse and sync.

## Installation

Install it from the Obsidian community plugin browser after the release is approved, or copy the release files from the GitHub release into your vault plugin folder.

Release files:

- `manifest.json`
- `main.js`
- `styles.css`

## Development status

This plugin is in active development and is being prepared for Obsidian community submission. See `PUBLISHING.md` for the release checklist.
