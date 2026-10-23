# filter-plugin-sample - Pixcall Group Filter (Pixcall 分组筛选)

A windowed Pixcall plugin that filters library entries by **tag groups** with
per-group logic (`any` / `all` / `exclude`), over a **folders multi-select
scope**, with a grid and a single-image viewer. It is built for real-world
libraries (24k+ entries, 145 tags) and shaped around what the host actually
exposes.

- Plugin id: `filter-plugin`
- Display name: **Pixcall Group Filter** (zh-CN: **Pixcall 分组筛选**)
- Version: 0.3.1

## Features

- **Tag-group filtering**: each tag group has its own mode.
  - `any` - match at least one tag of the group (union inside the group)
  - `all` - match every selected tag of the group
  - `exclude` - match entries carrying none of the group's tags
  - Groups combine with AND; an unmapped tag becomes its own `__unmapped__`
    bucket so it can still be filtered.
- **Scope = folders multi-select (union)**: collapsible tree, per-folder
  checkboxes, a global "include sub-folders" switch, folder search, and a
  **select-all / invert** bar that acts on the current search results (or on
  all folders when nothing is typed).
- **Batch tag input**: paste many tag names at once; the picker matches the
  longest tag name first, then fuzzes the leftovers by name / prefix / pinyin,
  and applies the confirmed set as removable chips.
- **Top metrics row**: `scope count | library total | hits | data source + time`.
- **Fullscreen / restore / close** on the filter page, grid and viewer (the
  window is frameless; the manifest sets `fullscreenable: true` and the UI
  provides a drag region).
- **Cache v4** in plugin storage (UTF-8 budget 3.6 MB of the 5 MB limit) with
  generation-swap writes (write-new -> verify -> delete-old), so a failed write
  never destroys the previous cache.
- **Diagnostics panel** replaces the old fake "follow main view" button; it
  shows what the host really returns for `entries.listSelected` and whether
  fullscreen is enabled.

## Why it is shaped this way

The Pixcall plugin SDK exposes no "current folder" API and no folder-scoped
entry listing; `entries.listSelected` returns the **checkbox selection**, not
the current view, and the plugin window is created with
`fullscreenable = manifest.window.fullscreenable === true`. Everything above is
designed around those measured facts, not around assumptions.

## Requirements

- Pixcall desktop (Windows x64), core >= 0.9.7.
- Node.js for local development and for running the test scripts.

## Install into Pixcall (packaged)

Copy this directory to the plugins folder, e.g.
`%APPDATA%\Pixcall\plugins\filter-plugin`, then restart Pixcall. Open the plugin
from the File menu, the folder-tree context menu, the entry-list context menu,
or `Shift+E`.

The committed `index.prod.html` + `assets/` bundle is already built
(`npm run build` output), so the plugin runs without a build step.

## Development

```sh
npm install
npm run dev        # Vite dev server (127.0.0.1:5173)
npm run build      # typecheck + build + sync assets
npm run test:e2e   # Playwright E2E suite (mock host)
npm run bench      # 24k-entry cache benchmark
```

`manifest.dev.json` and `manifest.json` must stay in sync (id, version,
`fullscreenable`, contributions, localization).

## Tests

- `scripts/e2e.v5.cjs` - 71 assertions: scope union, sub-folder toggle,
  select-all / invert on search results, batch tag parsing / applying /
  undoing, diagnostics payload, fullscreen state machine, cache write-failure
  safety, scope persistence, zero console errors.
- `scripts/bench-24107.cjs` - 24,107 entries: cache size, reload time, v3
  legacy cache readability.

## Known limits (host-imposed)

- No "follow current folder" feature - the host provides no such API.
- `entries.list` has no folder filter, so the plugin scans the whole library
  once and filters locally (the scope union is computed client-side).
- Window minimise / true maximise are unavailable; only fullscreen.
- Plugin storage is capped at 5 MB; the cache uses a conservative UTF-8 budget.
- Filtering cannot be pushed back into the main UI.

See [`docs/manifest.md`](../docs/manifest.md) for manifest fields and
contribution details.

## License

Same as the repository LICENSE file.
