# CAD Viewer Sample

A [Pixcall](https://pixcall.com/) CAD viewer sample built with Vue, Vite, and
the Pixcall SDK. It is based on
[`@mlightcad/cad-viewer`](https://github.com/mlightcad/cad-viewer) and supports
viewing DWG and DXF files, including common navigation, layer, measurement,
markup, and export features.

## Development

```sh
npm install
npm run dev
```

While the server is running, open the entire `cad-viewer-sample` directory as a
local plugin in Pixcall. Pixcall will use the development manifest and load the
plugin from the local HTTP server.

To try the plugin, open or select a DWG or DXF file in Pixcall. The viewer
follows Pixcall's language and light/dark theme settings.

## Build

```sh
npm run build
```

The production output is written to `dist/`. Use Pixcall's local or
packaged-plugin installation flow to load the generated `dist/` directory. The
packaged output uses `manifest.json` and `index.html`.
