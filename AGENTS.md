# AGENTS.md

Applies to all files in this repository.

## Quick orientation

- All plugin code lives in [`filter-plugin-sample/`](./filter-plugin-sample/).
  Before changing something, inspect its `package.json`, both manifests, the
  source entry points and `vite.config.mjs`.
- `manifest.dev.json` and `manifest.json` are both committed and must stay in
  sync: same `id`, same `version`, same contributions and window settings.
  The packaged entry is `index.prod.html` plus the built `assets/` bundle that
  the build syncs next to it.
- This plugin runs as a standalone window (`kind: "window"`,
  `fullscreenable: true`); there is no iframe mode and no viewer contribution.

## Environment and tooling

- Node.js 22+ and npm. The dev server is pinned to `127.0.0.1:5174`
  (see `package.json`).
- Keep UI code browser-compatible with the Pixcall plugin runtime; do not use
  Node.js-only APIs inside the plugin UI.

## Manifest and release rules

- Treat the plugin `id` as a stable public identifier.
- Keep `version` synchronized across `manifest.json`, `manifest.dev.json` and
  `package.json`.
- Keep localization keys in both `l10n/zh-CN.json` and `l10n/en.json` when UI
  text is user-facing.
- Follow the icon conventions referenced in the Pixcall manifest docs.
- `index.prod.html` + `assets/` are build outputs committed as a convenience
  so the plugin can be installed without a build step. Rebuild them with
  `npm run build` whenever source changes.

## Change rules

1. Keep the sample self-contained: source, manifests, assets, scripts and
   documentation live inside `filter-plugin-sample/`.
2. Keep `package.json` and `package-lock.json` synchronized.
3. Do not commit `node_modules/`, `dist/`, local env files or editor/agent
   workspace files.

## Security and dependencies

- Request only the permissions the features need (`storage`, `sqlite` read/write).
- Never commit keys, tokens, credentials or other secrets.
- Do not add network requests, telemetry or external services without a clear
  user-facing reason and matching documentation.
- Keep UI dependencies browser-compatible; verify notices in
  `filter-plugin-sample/THIRD-PARTY-NOTICES.md` when adding dependencies.

## Validation checklist

1. Run `npm run build` in `filter-plugin-sample/`.
2. Run `npm run test:e2e` (mock host; 71 assertions) and, when data is large,
   `npm run bench`.
3. Run `git diff --check` and review the final diff for unrelated changes.
4. For runtime changes, load the sample as a local plugin in Pixcall and test
   the command from the File menu, folder-tree context menu, or `Shift+E`.
5. Do not commit, push, or publish unless explicitly requested.
