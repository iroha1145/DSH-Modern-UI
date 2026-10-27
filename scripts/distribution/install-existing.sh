#!/bin/sh
set -eu
if [ "$#" -lt 3 ] || [ "$#" -gt 5 ]; then
  echo 'usage: install-existing.sh OFFICIAL_PACKAGE_JSON PLUGIN_TGZ PLUGIN_INTEGRITY [PROGRAM_ROOT] [DATA_HOME]' >&2
  exit 2
fi
backend=$1; plugin=$2; integrity=$3
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(sh "$here/program-root.sh" "${4:-}")
node=${DSH_MODERN_NODE:-node}
if candidate_version=$("$node" --version 2>/dev/null) && [ "$candidate_version" = 'v24.22.1' ]; then
  if [ "$#" -eq 5 ]; then
    exec "$node" "$here/install-existing.mjs" --backend "$backend" --plugin "$plugin" --plugin-integrity "$integrity" --root "$root" --home "$5" --skip-community "$(if [ "${DSH_MODERN_SKIP_COMMUNITY:-0}" = 1 ]; then printf true; else printf false; fi)"
  fi
  exec "$node" "$here/install-existing.mjs" --backend "$backend" --plugin "$plugin" --plugin-integrity "$integrity" --root "$root" --skip-community "$(if [ "${DSH_MODERN_SKIP_COMMUNITY:-0}" = 1 ]; then printf true; else printf false; fi)"
fi
exec sh "$here/bootstrap.sh" "$root" "${5:-}" "$plugin" "$integrity" "$backend"
