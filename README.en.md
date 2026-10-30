# DSH Modern UI

[中文](README.md) · English

A modern Web interface plugin for the official **DeepSeek Harness (DSH)**, published on npm as [`@iroha1145/dsh-modern-ui`](https://www.npmjs.com/package/@iroha1145/dsh-modern-ui). It leaves the official backend untouched, and you can switch back to the official interface at any time.

<p>
  <img src="docs/assets/screenshot-light.png" alt="Modern UI light theme: reasoning groups, official tool cards and the answer" width="49%">
  <img src="docs/assets/screenshot-dark.png" alt="Modern UI dark theme: code block, table and follow-up suggestions" width="49%">
</p>

## Install

Requirements:

- An official DSH in the 0.2 series from `0.2.1-rc.2` on (rc.2, rc.3 and rc.4 are verified; see the [compatibility matrix](docs/compatibility.md)).
- `pnpm` on PATH (`dsh plugin` calls it).
- The web profile has been started at least once; if not, run `dsh web` first.

```bash
dsh plugin --profile web add @iroha1145/dsh-modern-ui
```

Then refresh the browser.

- Preferences of the official chat interface (work-details view, collapse timing, usage display and so on) are not carried over; choose them again under Settings → General. The official settings are not deleted and apply again when you switch back.
- Offline install: download `modern-ui.tgz` from [Releases](https://github.com/iroha1145/DSH-Modern-UI/releases) and run `dsh plugin --profile web add ./modern-ui.tgz`.
- Installing from a Git URL is not supported.

## Switch back to the official interface

```bash
dsh plugin --profile web remove @iroha1145/dsh-modern-ui
```

Or disable the **whole** `@iroha1145/dsh-modern-ui` bundle in Plugin Management and refresh. Disabling only the inner `modern-ui` entry is not enough.

## Official Desktop (partly supported)

1. Open Desktop once, then quit it completely.
2. Install with **Desktop's own `dsh`** (the menu *App → Manage dsh command…* puts it on the terminal PATH):
   ```bash
   dsh plugin --profile desktop add @iroha1145/dsh-modern-ui
   ```
3. Reopen Desktop. To uninstall, use `remove` instead of `add` and restart Desktop again.

While Modern UI is on, Desktop's first-run onboarding is recorded as skipped. Native features such as file drag-out, multiple windows and *Open In…* are not verified yet; see the [Desktop acceptance record](docs/compatibility/desktop-0.2.1-rc.5.md).

## Features

- Conversation: collapsible reasoning groups, message timeline navigation, collapsible code blocks and Markdown previews.
- Input: quote selected text, paste or drop images at full quality, command and file reference chips.
- Cards: Intelligent UI (`openui` interactive components, `followups` suggestions), a sub-agent team view, tool call cards.
- Model picker cards with reasoning effort settings.
- 8 interface languages and several light and dark themes.

"Answer visual components" does not change the model prompt by default. Turning it on under Settings → General adds about 3 KB of instructions so answers use cards, diagrams and similar components.

## Optional: isolated one-step install

For machines without DSH, or when Modern UI should use its own program and data directories. Download `installer.zip` from [Releases](https://github.com/iroha1145/DSH-Modern-UI/releases), extract it and enter `plugin-preview`:

```bash
sh ./install.sh '/path/to/program' '/path/to/data'
```

On Windows: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -Root 'D:/DSH-Modern/program' -DataHome 'D:/DSH-Modern/data'`.

The installer prepares a private Node, pnpm and the official backend, backs up the data directory before installing, and migrates the official chat preferences. Installing on top of an existing DSH, adding community plugins, rollback and uninstall are covered in the [installation details](docs/install.md) (Chinese).

## FAQ

- **Nothing changed after installing**: refresh the browser first (restart Desktop). Then check that you installed into the running profile (`dsh web` uses `web`, Desktop uses `desktop`) and that the whole bundle is enabled in Plugin Management.
- **Community plugins**: `dsh-context@0.75.1` and `dsh-better-sidebar@0.28.0` are verified. Plugins that extend the official public slots generally coexist; plugins that depend on official internals or bring their own chat or layout interface are not guaranteed.
- **It broke after an official DSH upgrade**: check the [compatibility matrix](docs/compatibility.md). When the daily automated test finds a new version incompatible, it opens an [issue](https://github.com/iroha1145/DSH-Modern-UI/issues) titled `upstream: <version> 兼容失败`.

## Building locally

Requires Node.js 24:

```bash
npm ci --ignore-scripts
npm run build      # compile into packages/modern-ui/lib
npm run preview    # produce .artifacts/plugin-preview (tgz and installer)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and [CHANGELOG.md](CHANGELOG.md) for changes.

## Documentation

Mostly in Chinese: [installation details](docs/install.md) · [compatibility matrix](docs/compatibility.md) · [architecture](docs/architecture.md) · [legacy data migration](docs/data-migration.md) · [host compatibility layer](docs/host-compat.md)

## License

[MIT](LICENSE). Parts derived from DeepSeek Harness keep their upstream copyright; see [`THIRD_PARTY_NOTICES.md`](packages/modern-ui/THIRD_PARTY_NOTICES.md).
