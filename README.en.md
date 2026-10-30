# DSH Modern UI

[中文](README.md) · English

A modern Web interface plugin for the official **DeepSeek Harness (DSH)** (`@iroha1145/dsh-modern-ui`). It leaves the official backend unmodified, and you can switch back to the official interface at any time.

```bash
dsh plugin --profile web add @iroha1145/dsh-modern-ui
```

**Refresh the browser** after installing to see Modern UI. To switch back, see the [FAQ](#faq); supported host versions are in the [compatibility matrix](docs/compatibility.md).

> **Release status**: the npm package and GitHub Releases start with `v0.1.0`. Until that first version is out, neither the command above nor the Release downloads below work (if `npm view @iroha1145/dsh-modern-ui version` finds nothing, it is not published yet). Meanwhile, download `modern-ui-precompiled-preview` from the latest successful [Official runtime plugin preview](https://github.com/iroha1145/DSH-Modern-UI/actions/workflows/plugin-preview.yml?query=branch%3Amain+is%3Asuccess) run (GitHub sign-in required; kept for 7 days), unzip it, and run `dsh plugin --profile web add ./modern-ui.tgz` inside it.

<p>
  <img src="docs/assets/screenshot-light.png" alt="Modern UI light theme: reasoning groups, official tool cards and the answer" width="49%">
  <img src="docs/assets/screenshot-dark.png" alt="Modern UI dark theme: code block, table and follow-up suggestions" width="49%">
</p>

> Requirements: a supported official DSH release, with `pnpm` on PATH (`dsh plugin` forwards to pnpm). If you have never started the web profile, run `dsh web` once first. The model in the screenshots is a local demo model; [`tests/compat/readme-screenshots.mjs`](tests/compat/readme-screenshots.mjs) produces them in an isolated environment.
>
> The one-line install does **not** carry over the official chat interface's preferences (work-details view, collapse timing, usage display, link opening, what Enter does while busy, and so on). Modern UI starts from its own defaults; choose again under Settings → General. The official settings are not deleted and apply again when you switch back. The optional isolated installer below migrates these preferences.

---

## Features

- **Conversation**: a redesigned chat flow, grouped and folding reasoning, a turn timeline, and one-click folding of code blocks and Markdown previews.
- **Input**: quote selected text, drag or paste browser images losslessly, and command and file-reference chips (Lexical editor).
- **Views and cards**: built-in Intelligent UI (`openui` interactive sandbox and `followups` suggestions), subagent team tree and call-chain views, and detailed tool-call cards. Intelligent UI **does not change the model prompt** by default; it only renders `openui` / `followups` fences a model already wrote. Turning on *Settings → General → Answer visual components* appends about 3 KB of guidance to the system prompt. Installer users upgrading from older versions keep the previous behavior (on). `presentation.openui` / `presentation.followups` in the entry config turn off rendering of each fence (they then show as plain code blocks); see the [package README](packages/modern-ui/README.md).
- **Models and reasoning**: a modern model picker with custom model labels and reasoning effort, including `Off`.
- **Languages and themes**: 8 interface languages (Chinese, English, Japanese, Spanish, French, German, Russian, Portuguese) and several light and dark themes.

> **Note**: the old per-session web switch (`/web on|off`) is gone. Web search and fetch tools follow the official plugin management and configuration.

## Installation options

- **npm (recommended, once the first version is published)**: the one-line command above. Pin a version with `@iroha1145/dsh-modern-ui@<version>`.
- **GitHub Release (once the first version is published)**: each Release attaches `modern-ui.tgz` for offline installs with `dsh plugin --profile web add ./modern-ui.tgz`. Before that, use the CI build from "Release status" above with the same command.
- **Git sources are not supported** (`dsh plugin add github:iroha1145/DSH-Modern-UI`): the build dependencies live at the repository root, and pnpm 10+ blocks build scripts of Git dependencies by default. Use the npm package or the Release tgz.

## Official Desktop

The official DeepSeek Harness Desktop embeds the same Web Client and its own DSH host. Modern UI goes into its reserved `desktop` profile:

1. Open Desktop once, then quit it completely so it initializes the profile.
2. Install with **Desktop's own `dsh` command**. The menu *App → Manage dsh command…* puts it on the terminal PATH; the npm `dsh` refuses `--profile desktop`.
   ```bash
   dsh plugin --profile desktop add @iroha1145/dsh-modern-ui
   ```
   On Windows you can also run `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd` directly.
3. Quit and reopen Desktop. Desktop has no page reload, so switching the bundle means restarting the app.

To switch back, run `dsh plugin --profile desktop remove @iroha1145/dsh-modern-ui` and restart Desktop. While Modern UI is selected, Desktop's first-run onboarding is recorded as skipped, because its last step writes the official Chat settings that Modern replaces; adjust work details and usage display under *Settings → General*. Item-by-item results and the unverified native features are in the [Desktop acceptance record](docs/compatibility/desktop-0.2.1-rc.5.md).

## Optional: isolated one-step install

For machines **without an existing DSH**, or when Modern UI should use **separate program and data directories** (leaving an existing `~/.dsh` alone). This is a community-maintained, best-effort extra, not the main installation channel.

The installer downloads and verifies a private Node `24.22.1`, pnpm `11.28.5` (plus a private PowerShell `7.6.5` on Windows) and the official `@deepseek-ai/dsh` backend, creates its own profile, then installs the plugin through the official `dsh plugin add`. Before installing into or updating a non-empty data directory it takes a full snapshot backup. Download `installer.zip` from a Release, extract it and enter the `plugin-preview` directory (**the program and data directories must be two separate paths**):

- **Windows (PowerShell)**:
  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -Root 'D:/DSH-Modern/program' -DataHome 'D:/DSH-Modern/data'
  ```
- **macOS / Linux**:
  ```bash
  sh ./install.sh '/path/to/dsh-modern/program' '/path/to/dsh-modern/data'
  ```
- **On top of an existing official DSH** (reads its actual version, does not upgrade the backend):
  ```bash
  sh ./install-existing.sh '/path/to/official/@deepseek-ai/dsh/package.json' '/path/to/dsh-modern/program' '/path/to/dsh-modern/data'
  ```
  On Windows use `./install-existing.ps1 -Backend '<official package.json>' -Root '<program dir>' -DataHome '<data dir>'`.

Community plugins are **not installed** by default. To add the verified set (`dsh-context@0.75.1`, `dsh-better-sidebar@0.28.0`), append `-WithCommunity` on Windows or set `DSH_MODERN_WITH_COMMUNITY=1` on macOS / Linux. Pick an older host with `-BackendVersion` or `DSH_MODERN_BACKEND_VERSION`.

When it finishes, run `dsh-ui.cmd` (Windows) or `dsh-ui` (macOS / Linux) in the program directory. Status, verify, rollback and uninstall commands are in the [installation details](docs/install.md) (Chinese).

## FAQ

### Nothing changed after installing

Refresh the browser first (quit and reopen Desktop). If you still see the official interface, check in Plugin Management that the whole `@iroha1145/dsh-modern-ui` bundle is enabled, and that you installed into the profile that is running: `dsh web` uses `web`, Desktop uses `desktop`. If the host's startup log says `entry did not activate`, the entries that did not activate and the reasons follow it.

### Does it work with community plugins such as better-sidebar?

The verified set is `dsh-context@0.75.1` and `dsh-better-sidebar@0.28.0`; every compatibility run includes them. Other plugins that contribute through the official public slots generally coexist. Plugins that depend on official private DOM or internal methods, and plugins that bring their own chat or layout interface, are not guaranteed to work; see the [compatibility matrix](docs/compatibility.md).

### How do I switch back to the official interface?

Disable the **whole** bundle in Plugin Management and refresh, or run `dsh plugin --profile web remove @iroha1145/dsh-modern-ui`. Disabling only the inner `modern-ui` entry is not enough: the bundle disables seven official interface modules and restores them only when the whole bundle is off. If your config holds explicit host compatibility bindings, see the extra step before removal in the [installation details](docs/install.md).

### The plugin broke after an official DSH upgrade

Check the [compatibility matrix](docs/compatibility.md) first: whether the new version is inside the supported range and whether it is verified. A daily canary runs the compatibility suite against new official versions and, on failure, opens an [issue](https://github.com/iroha1145/DSH-Modern-UI/issues) titled `upstream: <version> 兼容失败` with the failure evidence and the upstream changes most likely involved. Until a fix ships, you can go back to the newest verified host in the matrix. If there is no matching issue, please open one with your DSH version, platform and startup log.

### Is the official Desktop supported?

Partly. On Desktop 0.2.1-rc.5 / Windows x64 the 12 Web Client checks, theme following, narrow viewport and remove/reinstall all pass; native file drag-out, multiple windows, *Open In…*, the native directory picker and the macOS shell are not verified yet. Installation steps are under [Official Desktop](#official-desktop) above; item-by-item results are in the [Desktop acceptance record](docs/compatibility/desktop-0.2.1-rc.5.md).

## Building locally

Requires Node.js 24 (CI uses `24.22.1`); the repository uses npm and `package-lock.json`:

```bash
npm ci --ignore-scripts
npm run build      # compile the plugin into packages/modern-ui/lib
npm run preview    # produce .artifacts/plugin-preview (tgz + optional installer)
```

## Documentation

Most documents are in Chinese.

- [Installation details](docs/install.md), [compatibility matrix](docs/compatibility.md), [architecture and UI mapping](docs/architecture.md) (with an ownership diagram for third-party plugin authors), [legacy data migration](docs/data-migration.md), [host compatibility layer](docs/host-compat.md)
- Audit and PR follow-up records are in [`docs/history/`](docs/history/)
- The old "download upstream sources, patch and rebuild" route has been removed from main; see the tag [`legacy-patch-final`](https://github.com/iroha1145/DSH-Modern-UI/tree/legacy-patch-final)

## License

[MIT](LICENSE). Parts derived from DeepSeek Harness keep their upstream copyright; see [`THIRD_PARTY_NOTICES.md`](packages/modern-ui/THIRD_PARTY_NOTICES.md).
