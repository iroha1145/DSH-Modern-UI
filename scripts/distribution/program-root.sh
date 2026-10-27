#!/bin/sh
set -eu
if [ -n "${1:-}" ]; then
  printf '%s\n' "$1"
  exit 0
fi
base=${XDG_DATA_HOME:-"$HOME/.local/share"}
canonical=$base/dsh-modern-ui
legacy=$base/DSH-Modern-UI
# -ef compares filesystem identity, including symlink and case-insensitive aliases.
if [ -d "$canonical" ] && [ -d "$legacy" ] && ! [ "$canonical" -ef "$legacy" ]; then
  printf 'Both %s and %s exist. Pass an explicit program root (--root or PROGRAM_ROOT); no directories were merged.\n' "$canonical" "$legacy" >&2
  exit 1
fi
if [ -d "$legacy" ] && [ ! -d "$canonical" ]; then
  printf '%s/program\n' "$legacy"
else
  printf '%s/program\n' "$canonical"
fi
