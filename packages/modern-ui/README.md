# DSH Modern UI

A modern Web interface for the official, unmodified [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): redesigned chat flow, reasoning folds, tool cards, model selection, themes and eight interface languages.

## Install

```bash
dsh plugin --profile web add @iroha1145/dsh-modern-ui
```

Then refresh the browser. `dsh plugin` forwards to pnpm, so `pnpm` must be on PATH. If you have never started the web profile, run `dsh web` once first.

## Switch back to the official UI

Deselect the whole `@iroha1145/dsh-modern-ui` bundle in Plugin Management and refresh, or remove the plugin:

```bash
dsh plugin --profile web remove @iroha1145/dsh-modern-ui
```

Deselecting only the inner `modern-ui` entry is not enough: the bundle disables seven official UI owners and returns them only when the bundle itself is off.

## Compatibility

Supported host versions are declared in `dsh.compatibleHost` and listed in the [compatibility matrix](https://github.com/iroha1145/DSH-Modern-UI/blob/main/docs/compatibility.md).

## Known limitations

- Changing the bundle selection requires a browser refresh.
- Git-hosted installs (`dsh plugin add github:...`) are not supported; use this npm package or the `modern-ui.tgz` attached to each GitHub Release.
- Session-level web switches (`/web on|off`) are retired; web tools follow the official plugin configuration.

## License

MIT. Portions derived from DeepSeek Harness and other projects keep their notices in `THIRD_PARTY_NOTICES.md` and `licenses/`.
