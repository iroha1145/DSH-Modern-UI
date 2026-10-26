#!/usr/bin/env bash
# Start DSH-UI. The installer copies this file to <install dir>/dsh-ui, next to launch.conf.
# Arguments go to the dsh CLI; with none it boots the profile chosen at install (normally web).
# The web profile's workspace-write root is process.cwd(). Keep the caller's directory when
# that is a project; if the caller is the real home, use <data>/workspace instead so the
# default root is not $HOME and does not include ~/.ssh. Relative paths resolve from there.
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
export DSH_HOME="${DSH_UI_HOME:-$DIR/data}"
node="$DIR/runtime/node/bin/node"
if [ ! -x "$node" ]; then
  printf 'dsh-ui: 找不到 %s，请重新运行安装脚本\n' "$node" >&2
  exit 1
fi
export PATH="$DIR/runtime/node/bin:$DIR/runtime/node_modules/.bin:$PATH"
export TSX_TSCONFIG_PATH="$DIR/dsh/tsconfig.json"

[ $# -gt 0 ] || set -- "${DSH_UI_PROFILE:-web}"
# --import takes a URL; a path with # or % in it would not survive as a bare specifier.
loader="$("$node" -p 'require("node:url").pathToFileURL(process.argv[1]).href' "$DIR/dsh/node_modules/tsx/dist/esm/index.mjs")"
home_dir="$(CDPATH= cd -- "$HOME" && pwd -P)"
if [ "$(pwd -P)" = "$home_dir" ]; then
  workspace="$DSH_HOME/workspace"
  mkdir -p -- "$workspace"
  CDPATH= cd -- "$workspace"
  if [ "$(pwd -P)" = "$home_dir" ]; then
    printf 'dsh-ui: 默认工作区不能是主目录\n' >&2
    exit 1
  fi
fi
exec "$node" --import "$loader" "$DIR/dsh/apps/cli/src/bin.ts" "$@"
