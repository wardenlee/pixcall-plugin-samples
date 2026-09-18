# AGENTS.md

Applies to all files in this repository. A more specific `AGENTS.md` inside a
sample directory may add or override rules for that sample.

## Quick orientation

- Work inside the sample directory you are changing. Before making changes,
  inspect its `package.json`, manifests, relevant source entry points, and
  `vite.config.mjs`.
- During local development, `manifest.dev.json` points contributions to the
  development server. For packaged builds, `manifest.json` points to
  `index.html`, and the build copies the runtime assets required by the
  manifest into `dist/`.
- When changing a feature, start with its manifest contribution, then trace
  its UI entry point and the Pixcall SDK context it consumes.

See [`docs/manifest.md`](docs/manifest.md) for manifest fields, directory
layout, localization format, permissions, contribution definitions, and asset
conventions.

## Environment and tooling

- Use Node.js 24.11 or later and npm for local development.
- Keep browser-facing code compatible with the Pixcall plugin runtime. Avoid
  adding Node.js-only APIs to code that runs inside the plugin UI.

## Local commands

Run the target sample's scripts from its directory:

```sh
npm install       # Install dependencies
npm run dev       # Start the local development server
npm run build     # Check types and build the production output into dist/
```

All samples use `127.0.0.1:5173` for development. Run only one sample's
development server at a time unless its port and development manifest are
intentionally changed together.

## Manifest and release rules

- Treat the plugin `id` as a stable public identifier. Do not change it after
  a plugin has been published.
- Keep `manifest.json` for packaged builds and `manifest.dev.json` for local
  development. Update both when a manifest field is intentionally shared.
- Keep the `version` in `manifest.json`, `manifest.dev.json`, and
  `package.json` synchronized.
- Keep manifest contribution IDs, command IDs, and localization keys stable
  once they are used by consumers.
- Add localization keys to every locale file when manifest or UI text is
  user-facing.
- Follow the icon conventions documented in [`docs/manifest.md`](docs/manifest.md).
- Build output should contain the plugin files, manifest, icons, localization
  files, license files, and third-party notices required by the plugin. Do not
  include source-only or development files unless the runtime requires them.

## Change rules

1. Keep each plugin sample self-contained. Place sample-specific source code,
   manifests, assets, scripts, documentation, and dependency files inside the
   sample directory.
2. Keep `package.json` and the sample lockfile synchronized when changing
   dependencies.
3. Do not commit `node_modules/`, `dist/`, local environment files, or
   editor-specific workspace files.

## Security and dependencies

- Request only the permissions required by the plugin's features.
- Never commit private keys, access tokens, credentials, or other secrets.
- Do not add network requests, telemetry, or external services without a clear
  user-facing reason and corresponding documentation.
- Keep plugin UI dependencies browser-compatible.
- Preserve repository and sample license files, `third-party-licenses/`, and
  `THIRD-PARTY-NOTICES.md`; verify notices when adding or updating dependencies.

## Validation checklist

Before completing a code or configuration change:

1. Run the relevant sample's build command.
2. Run `git diff --check`.
3. Review the final diff and avoid unrelated changes.
4. For runtime changes, start `npm run dev`, load the sample directory as a
   local plugin in Pixcall, and test the contribution with a matching file or
   selection. Keep the server running while testing.
5. Do not commit, push, or publish changes unless explicitly requested.
