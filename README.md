# Pixcall Plugin Samples

A focused collection of Pixcall plugins. This repository currently hosts one
production-grade sample:

- [`filter-plugin-sample`](./filter-plugin-sample/) — **Pixcall Group Filter
  (Pixcall 分组筛选)**: filter library entries by tag groups with per-group
  `any` / `all` / `exclude` logic, over a folders multi-select scope, with a
  grid and a single-image viewer.

Open its [README](./filter-plugin-sample/README.md) for features, installation,
development and test instructions.

> The previous five samples (cad-viewer, exif-inspector, image-editor,
> pdf-viewer, slideshow) were replaced by this plugin on 2026-10-23. Their
> content is preserved on the branch
> [`backup/2026-10-23-pre-replace`](https://github.com/wardenlee/pixcall-plugin-samples/tree/backup/2026-10-23-pre-replace).

## Start here

New to Pixcall plugin development? The
[Getting Started guide](docs/getting-started.md) walks you through installing
the tools, running your first sample, testing it in Pixcall, and building a
packaged plugin.

## Learn more

- [Plugin Manifest](docs/manifest.md) — manifest fields, contributions,
  permissions, localization, and directory structure.
- [Pixcall Plugin SDK](https://www.npmjs.com/package/pixcall) — the SDK used by
  the plugin.

## Contact

If you have any questions or suggestions, please open an issue on this
repository.

## License

The repository root is licensed under the MIT License. See
[LICENSE](./LICENSE).

Before redistributing the sample, check its `package.json` and
`THIRD-PARTY-NOTICES.md`; preserve the license files and notices that belong to
it.
