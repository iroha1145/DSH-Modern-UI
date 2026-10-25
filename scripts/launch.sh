#!/usr/bin/env bash
# Start DSH-UI. The installer copies this file to <install dir>/dsh-ui, next to launch.conf.
# Arguments go to the dsh CLI; with none it boots the profile chosen at install (normally web).
# DSH runs from the home directory, so relative paths in arguments resolve from there.
set -euo pipefail

# Follow symlinks so a link placed on PATH still finds the install directory.
self="${BASH_SOURCE[0]}"
while [ -L "$self" ]; do
  target="$(readlink "$self")"
  case "$target" in
    /*) self="$target" ;;
    *) self="$(dirname "$self")/$target" ;;
  esac
done
DIR="$(cd "$(dirname "$self")" && pwd)"

DSH_UI_HOME=""
DSH_UI_PROFILE=""
if [ -f "$DIR/launch.conf" ]; then
  # shellcheck disable=SC1091 # written by the installer
  . "$DIR/launch.conf"
fi
# The data directory chosen at install wins over an exported DSH_HOME meant for another DSH.
export DSH_HOME="${DSH_UI_HOME:-${DSH_HOME:-$HOME/.dsh}}"
node="$DIR/runtime/node/bin/node"
if [ ! -x "$node" ]; then
  printf 'dsh-ui: 找不到 %s，请重新运行安装脚本\n' "$node" >&2
  exit 1
fi
export PATH="$DIR/runtime/node/bin:$DIR/runtime/node_modules/.bin:$PATH"
export TSX_TSCONFIG_PATH="$DIR/dsh/tsconfig.json"

[ $# -gt 0 ] || set -- "${DSH_UI_PROFILE:-web}"
# DSH-UI has its own 编队 view; hide dsh-context's fleet tab unless asked to keep it. The CLI reads
# its own flags only up to the first one it does not know, so the overlay goes right after the
# profile name.
case "$1" in
  -*) ;;
  *)
    if [ "${DSH_UI_CONTEXT_FLEET_TAB:-hide}" != show ] && [ -d "$DSH_HOME/profiles/$1/node_modules/dsh-context" ]; then
      first="$1"
      shift
      set -- "$first" --patch "$DIR/overlays/context-fleet-tab.yml" "$@"
    fi
    ;;
esac

# --import takes a URL; a path with # or % in it would not survive as a bare specifier.
loader="$("$node" -p 'require("node:url").pathToFileURL(process.argv[1]).href' "$DIR/dsh/node_modules/tsx/dist/esm/index.mjs")"
cd "$HOME"
exec "$node" --import "$loader" "$DIR/dsh/apps/cli/src/bin.ts" "$@"
