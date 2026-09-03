# Pixcall Plugin Samples

A collection of focused, self-contained sample plugins for
[Pixcall](https://pixcall.com/). Each sample demonstrates a specific plugin
capability, including viewers, inspectors, and command-driven tools.

Use these projects to learn how Pixcall plugins are structured, run a sample
locally, and start adapting one into your own plugin.

## Start here

New to Pixcall plugin development? The
[Getting Started guide](docs/getting-started.md) walks you through installing
the tools, running your first sample, testing it in Pixcall, and building a
packaged plugin.

## Samples

- [`cad-viewer-sample`](./cad-viewer-sample/) — View DWG and DXF files in
  Pixcall.
- [`exif-inspector-sample`](./exif-inspector-sample/) — Inspect image EXIF
  metadata.
- [`image-editor-sample`](./image-editor-sample/) — Crop a selected image in
  an independent editor window.
- [`pdf-viewer-sample`](./pdf-viewer-sample/) — View PDF files in Pixcall.
- [`slideshow-sample`](./slideshow-sample/) — Open selected files in a
  fullscreen slideshow.

Each sample is an independent project with its own dependencies and development
server. Choose one and open its README for feature-specific instructions.

## Learn more

- [Plugin Manifest](docs/manifest.md) — manifest fields, contributions,
  permissions, localization, and directory structure.
- [Pixcall Plugin SDK](https://www.npmjs.com/package/pixcall) — the SDK used
  by the samples.

## Contact

If you have any questions or suggestions, please
[contact us](https://docs.pixcall.com/docs/about/contact-us/). We would love to
hear your feedback.

## License

The repository root is licensed under the MIT License. See
[LICENSE](./LICENSE).

Some samples have their own license terms. Before redistributing a sample,
check its `LICENSE`, `package.json`, and `THIRD-PARTY-NOTICES.md`. Preserve the
license files and notices that belong to the corresponding sample.
