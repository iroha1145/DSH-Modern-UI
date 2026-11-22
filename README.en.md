<div align="center">

# DSH Modern UI

A cleaner, modern Web interface for the official DeepSeek Harness (DSH)

[简体中文](README.md) · English

<p>
  <a href="https://www.npmjs.com/package/@iroha1145/dsh-modern-ui"><img src="https://img.shields.io/npm/v/@iroha1145/dsh-modern-ui?style=for-the-badge&logo=npm&logoColor=white&color=4D6BFE" alt="npm"/></a>
  <img src="https://img.shields.io/badge/DSH-0.2.x-4D6BFE?style=for-the-badge" alt="DSH 0.2"/>
  <img src="https://img.shields.io/badge/Languages-8-0F9D58?style=for-the-badge" alt="8 interface languages"/>
  <img src="https://img.shields.io/badge/License-MIT-3DA639?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="MIT"/>
</p>

[Screenshots](#screenshots) · [Features](#features) · [Install](#install) · [FAQ](#faq) · [Compatibility](docs/compatibility.md) · [Changelog](CHANGELOG.md) · [Issues](https://github.com/iroha1145/DSH-Modern-UI/issues)

</div>

<p align="center">
  <img src="docs/assets/readme/conversation-light.webp" width="1200" alt="Conversation: grouped reasoning, tool call rows and an inline code diff">
</p>

Published on npm as [`@iroha1145/dsh-modern-ui`](https://www.npmjs.com/package/@iroha1145/dsh-modern-ui). It leaves the official backend untouched, and you can switch back to the official interface at any time.

## Screenshots

Full desktop browser windows, light on the left and dark on the right, with the interface set to Chinese. Apart from the home page, they come from a local isolated instance driven by a scripted test model: the conversations and numbers are examples, and no external service was called.

| View | Light | Dark |
| --- | --- | --- |
| Home | ![Home, light](docs/assets/home-light.webp) | ![Home, dark](docs/assets/home-dark.webp) |
| Conversation | ![Conversation, light](docs/assets/readme/conversation-light.webp) | ![Conversation, dark](docs/assets/readme/conversation-dark.webp) |
| Diff panel | ![Side-by-side diff, light](docs/assets/readme/diff-preview-light.webp) | ![Side-by-side diff, dark](docs/assets/readme/diff-preview-dark.webp) |
| Team view | ![Team view, light](docs/assets/readme/fleet-light.webp) | ![Team view, dark](docs/assets/readme/fleet-dark.webp) |
| Settings | ![General settings, light](docs/assets/readme/settings-presentation-light.webp) | ![General settings, dark](docs/assets/readme/settings-presentation-dark.webp) |

### Close-ups

| Close-up | Light | Dark |
| --- | --- | --- |
| Model picker | ![Model picker, light](docs/assets/readme/closeup-model-light.webp) | ![Model picker, dark](docs/assets/readme/closeup-model-dark.webp) |
| Question card | ![Question card, light](docs/assets/readme/closeup-ask-light.webp) | ![Question card, dark](docs/assets/readme/closeup-ask-dark.webp) |
| Turn timeline | ![Turn timeline, light](docs/assets/readme/closeup-timeline-light.webp) | ![Turn timeline, dark](docs/assets/readme/closeup-timeline-dark.webp) |
| Quote selected text | ![Quote selection, light](docs/assets/readme/closeup-quote-light.webp) | ![Quote selection, dark](docs/assets/readme/closeup-quote-dark.webp) |

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

### Reading

- **Reasoning folds**: long reasoning is grouped into steps (analysis, search, edits) and folds away when the answer is done; open any step for details.
- **Turn timeline**: marks on the right edge preview each turn on hover and jump to it on click.
- **Conversation width**: Reading, Standard, Wide, or Custom with draggable guides (Settings → General → Conversation width).
- **Collapsible long content**: code blocks, diffs, math and side-panel file and plan previews fold and unfold.

### Answers as interactive cards

With "Answer visual components" on, answers can use number cards, charts (bar, line, pie, scatter, with an expandable data table), flow diagrams, tables, flashcards and small calculators with sliders, all in the interface's own fonts and theme. `followups` fences become suggestion chips under the answer, and "Deliver results in stages" lets the model hand over finished parts of a long task first. Built on [OpenUI](https://github.com/thesysdev/openui) (`openui-lang` fences).

| Light | Dark |
| --- | --- |
| ![Number cards and a line chart, light](docs/assets/readme/visual-chart-light.webp) | ![Number cards and a line chart, dark](docs/assets/readme/visual-chart-dark.webp) |
| ![Flow diagram, slider calculator and follow-ups, light](docs/assets/readme/visual-flow-light.webp) | ![Flow diagram, slider calculator and follow-ups, dark](docs/assets/readme/visual-flow-dark.webp) |

### Tools and changes

- Terminal commands, file reads and edits, code and web search and to-do lists each get their own row; edits show added and removed lines inline, and the "Edited" card opens a side-by-side diff in the right panel.
- The to-do list stays pinned above the input box and ticks off each step.
- When the AI needs a decision it shows a question card with options (several questions, skip, or a free answer), and the sidebar marks the session as waiting for your answer; plans the AI proposes appear as cards for you to confirm.
- **Team view**: when the main agent starts several sub-agents, the Team tab shows each one's model, usage, time and status as a tree.

### Input

- The model panel groups models by vendor, gives each a one-line description and compares speed, quality and cost with bars; hovering a model shows its typical first-token time and price per million tokens. Reasoning effort is set in the same panel; extra switches from third-party model plugins (context length, fast mode and so on) sit next to the input box.
- Select any text in the conversation and use the quote button that appears to ask about it.
- Paste or drop images at full quality, drag them out to save, and keep typing while the AI answers: the next message is queued.

### Languages, themes and phones

8 interface languages (Chinese, English, Japanese, Spanish, French, German, Russian, Portuguese) and light, dark or system themes. On narrow screens the sidebar becomes a drawer, and the input box and settings are rearranged for touch. The plugin market shows each plugin's full illustrated documentation.

<table>
  <tr><th>Home</th><th>Sidebar drawer</th><th>Conversation</th></tr>
  <tr>
    <td align="center"><img src="docs/assets/readme/mobile-home-light.webp" width="240" alt="Phone home, light" /></td>
    <td align="center"><img src="docs/assets/readme/mobile-drawer-light.webp" width="240" alt="Phone drawer, light" /></td>
    <td align="center"><img src="docs/assets/readme/mobile-chat-light.webp" width="240" alt="Phone conversation, light" /></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/readme/mobile-home-dark.webp" width="240" alt="Phone home, dark" /></td>
    <td align="center"><img src="docs/assets/readme/mobile-drawer-dark.webp" width="240" alt="Phone drawer, dark" /></td>
    <td align="center"><img src="docs/assets/readme/mobile-chat-dark.webp" width="240" alt="Phone conversation, dark" /></td>
  </tr>
</table>

"Answer visual components" does not change the model prompt by default. Turning it on under Settings → General adds about 30 KB (roughly 7,000 tokens) of instructions so answers use cards, diagrams and similar components. The components need Chrome/Edge 111, Safari 16.2, Firefox 121 or newer.

Optional: with [TypeSafe](https://typesafe.ai) Jev access, turn on "Answer visual components", then enter and save the key under Settings → General → Jev presentation advice (or put it in the environment or DSH's `.env` as `TYPESAFE_API_KEY`). The main session's model then has an optional tool: when it is unsure how to present an answer, it can ask Jev for a second opinion on text, a table, cards, steps, a chart, a flowchart, a drawing, a calculator, or several visuals together. Whether to ask is up to the model; not asking is normal, and the final answer may be all Markdown. Jev sees only the user's request for the turn and a short outline of the content's structure written by the model (at most 600 characters), not the sources, so its reply is advice only: "plain text" means no additional suggestion, and a visual choice is a candidate the model may ignore, replace or combine with other forms. Jev is asked at most once per turn. The tool is absent without a key, with Jev switched off or with "Answer visual components" off, and subagents never see it; when Jev times out or fails, the tool answers that no suggestion is available and the turn goes on.

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
