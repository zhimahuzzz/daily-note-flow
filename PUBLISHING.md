# Publishing Daily Note Flow

This document tracks the steps required to make Daily Note Flow downloadable from the Obsidian community plugin browser.

## Repository shape

The Obsidian plugin repository should use `obsidian-dailynote-plugin/` as the repository root.

Required root files:

- `manifest.json`
- `README.md`
- `versions.json`
- `LICENSE`
- `package.json`
- `src/main.ts`
- `styles.css`

Do not commit the compiled `main.js` bundle or release assets into the source repository root.

## Release files

Each GitHub release must attach:

- `main.js`
- `manifest.json`
- `styles.css`

The release tag should match `manifest.json`:

```text
0.1.5
```

## Current settings to declare

- Default root folder: `Daliy_Note`
- Daily notes folder: `Daliy_Note/Daily`
- Weekly summaries folder: `Daliy_Note/Weekly`
- Monthly summaries folder: `Daliy_Note/Monthly`
- AI base URL: `https://api.deepseek.com`
- AI model: `deepseek-v4-flash`

## Privacy declaration

Daily Note Flow stores Markdown notes inside the user's own Obsidian vault.

DeepSeek AI polishing is optional. When AI polishing is used, the relevant Markdown content is sent to the configured AI API endpoint.

## Submission checklist

- [ ] Create a public GitHub repository named `daily-note-flow`
- [ ] Push this plugin folder as the repository root
- [ ] Create release `0.1.5`
- [ ] Attach `main.js`, `manifest.json`, and `styles.css`
- [ ] Submit the plugin through the Obsidian community plugin submission flow
- [ ] Respond to review feedback
