# DSH Modern UI

A modern Web interface for the official, unmodified [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): redesigned chat flow, reasoning folds, tool cards, model selection, themes and eight interface languages.

## Install

```bash
dsh plugin --profile web add @iroha1145/dsh-modern-ui
```

Then refresh the browser. `dsh plugin` forwards to pnpm, so `pnpm` must be on PATH. If you have never started the web profile, run `dsh web` once first.

## Model-visible behavior

Modern UI does not change the model prompt by default. It renders `openui-lang` (OpenUI) and `followups` code fences a model already wrote. Turning on **Settings → General → Answer visual components** appends about 30 KB (roughly 7,000 tokens) of presentation guidance to the system prompt. The same switches live in the entry config:

```yaml
presentation:
  prompt: false    # model-visible guidance
  openui: true     # render openui-lang fences as OpenUI components
  followups: true  # render followups fences as suggestion chips
jev:               # optional TypeSafe Jev presentation routing
  enabled: true                    # active only with the presentation prompt on and a key present
  credential: TYPESAFE_API_KEY     # environment-variable name the DSH credentials service resolves
  model: jev-latest
  endpoint: https://api.typesafe.ai/v1/systemone
  timeout: 4000                    # ms; past it the turn goes ahead without a hint
```

With a key, each new user message in a main session (not subagents) sends the last four user/assistant texts, at most 6,000 characters each, to TypeSafe. Jev's choice reaches the model as a one-line runtime-context hint; the system prompt does not change, so prompt caches stay valid. A missing key, an error, an invalid answer or a timeout adds no hint and never fails a turn.

## Switch back to the official UI

Deselect the whole `@iroha1145/dsh-modern-ui` bundle in Plugin Management and refresh, or remove the plugin:

```bash
dsh plugin --profile web remove @iroha1145/dsh-modern-ui
```

Deselecting only the inner `modern-ui` entry is not enough: the bundle disables seven official UI owners and returns them only when the bundle itself is off.

## Official Desktop

The DeepSeek Harness Desktop app renders the same Web Client over its own embedded host and keeps plugins in the reserved `desktop` profile:

1. Open Desktop once, then quit it completely so it initializes the profile.
2. Install with **Desktop's own `dsh` command** (menu *App → Manage dsh command…* puts it on the terminal PATH; on Windows it is `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`). The npm `dsh` refuses `--profile desktop`.
   ```bash
   dsh plugin --profile desktop add @iroha1145/dsh-modern-ui
   ```
3. Quit and reopen Desktop. Desktop has no page reload, so switching the bundle means restarting the app.

To switch back, run `dsh plugin --profile desktop remove @iroha1145/dsh-modern-ui` with the same command and restart Desktop. While Modern UI is selected, Desktop's first-run onboarding is recorded as skipped because its last step writes the official Chat settings this bundle replaces; adjust work details and usage display under Settings → General. Native bridges (dragging files out to the OS, multiple windows, *Open In…*, the native directory picker) are not verified yet; see the [Desktop acceptance record](https://github.com/iroha1145/DSH-Modern-UI/blob/main/docs/compatibility/desktop-0.2.1-rc.5.md).

## Compatibility

Supported host versions are declared in `dsh.compatibleHost` and listed in the [compatibility matrix](https://github.com/iroha1145/DSH-Modern-UI/blob/main/docs/compatibility.md).

## Known limitations

- Changing the bundle selection requires a browser refresh (an app restart in Desktop).
- Git-hosted installs (`dsh plugin add github:...`) are not supported; use this npm package or the `modern-ui.tgz` attached to each GitHub Release.
- Session-level web switches (`/web on|off`) are retired; web tools follow the official plugin configuration.

## License

MIT. Portions derived from DeepSeek Harness and other projects keep their notices in `THIRD_PARTY_NOTICES.md` and `licenses/`.
