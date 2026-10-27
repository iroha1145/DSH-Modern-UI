#!/bin/sh
set -eu
if [ "$#" -lt 3 ] || [ "$#" -gt 5 ]; then
  echo 'usage: install-existing.sh OFFICIAL_PACKAGE_JSON PLUGIN_TGZ PLUGIN_INTEGRITY [PROGRAM_ROOT] [DATA_HOME]' >&2
  exit 2
fi
backend=$1; plugin=$2; integrity=$3
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=${4:-"${XDG_DATA_HOME:-$HOME/.local/share}/dsh-modern-ui/program"}
node=${DSH_MODERN_NODE:-node}
expected=$("$node" -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).nodeVersion" "$here/runtime-lock.json")
if [ "$("$node" --version)" != "v$expected" ]; then echo 'Use bootstrap.sh to prepare the pinned Node runtime.' >&2; exit 1; fi
if [ "$#" -eq 5 ]; then data_home=$5
elif [ -f "$root/current.json" ]; then data_home=$("$node" -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).home" "$root/current.json")
else data_home="$(dirname -- "$root")/data-$(date +%s)-$$"; fi
started=$(date -u +%Y-%m-%dT%H:%M:%SZ); epoch=$(date +%s)
if core=$("$node" "$here/manager.mjs" install --root "$root" --home "$data_home" --backend "$backend" --node "$(command -v "$node")" --plugin "$plugin" --plugin-integrity "$integrity"); then
  printf '{"phase":"core","result":%s}\n' "$core"
else status=$?; printf '{"phase":"core","result":{"state":"failed","exitCode":%s}}\n' "$status"; exit "$status"; fi
if [ "${DSH_MODERN_SKIP_COMMUNITY:-0}" = 1 ]; then printf '{"phase":"community","result":{"state":"skipped"}}\n'
elif community=$("$node" "$here/manager.mjs" community --root "$root"); then printf '{"phase":"community","result":%s}\n' "$community"
else printf '{"phase":"community","result":{"state":"failed","coreRetained":true}}\n'; fi
printf '{"phase":"timing","result":{"startedAt":"%s","completedAt":"%s","elapsedSeconds":%s,"backend":"existing","nodeDownloaded":false,"clockResolutionSeconds":1}}\n' "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(($(date +%s)-epoch))"
