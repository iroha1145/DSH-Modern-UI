# DSH Modern UI

Modern UI runs as an independent plugin on exact, verified official DSH releases. The preview's compatibility manifest selects the backend and preserves an existing installation's version; rc.4 remains the new-install default. This package is a precompiled, unpublished preview.

## Features

- Modern chat, model selection, settings, tool cards, themes and eight interface languages.
- Selected-text quotes, original image transfers and expandable Markdown code blocks.
- Model labels supplied through the standard extension slot and editable reasoning wire values, including Off.
- Installed and discoverable plugin documentation with language selection and images.

Session web switches and `/web on|off` are retired. Web tools continue to use official plugin configuration.

## Installation

Use the preview installer with separate program and data directories. It installs the plugin through the official plugin manager and snapshots an existing nonempty data home before writing it.

```powershell
node ./install-existing.mjs --backend 'D:/official/node_modules/@deepseek-ai/dsh/package.json' --root 'D:/DSH Modern/program' --home 'D:/DSH Modern/data'
```

Changing the selected program generation does not restore old data. Keep the recorded data snapshot when recovering an earlier environment.

See the [project documentation](https://github.com/iroha1145/DSH-Modern-UI) for installation, validation and compatibility boundaries.
