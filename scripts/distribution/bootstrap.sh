#!/bin/sh
set -eu
# Positional arguments keep spaces/non-ASCII paths intact without eval or shell-built commands.
if [ "$#" -lt 4 ] || [ "$#" -gt 5 ]; then
  echo 'usage: bootstrap.sh PROGRAM_ROOT DATA_HOME PLUGIN_TGZ PLUGIN_SHA512_INTEGRITY [OFFICIAL_PACKAGE_JSON]' >&2
  exit 2
fi
root=$1; data_home=$2; plugin=$3; integrity=$4
started=$(date -u +%Y-%m-%dT%H:%M:%SZ); epoch=$(date +%s)
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) target=linux-x64; extension=tar.xz; hash=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6 ;;
  Linux-aarch64|Linux-arm64) target=linux-arm64; extension=tar.xz; hash=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e ;;
  Darwin-x86_64) target=darwin-x64; extension=tar.gz; hash=d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035 ;;
  Darwin-arm64) target=darwin-arm64; extension=tar.gz; hash=89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7 ;;
  *) echo 'Unsupported platform; no source-build fallback.' >&2; exit 1 ;;
esac
mkdir -p -- "$root"
bootstrap=$(mktemp -d "$root/bootstrap-XXXXXXXX")
trap 'rm -rf -- "$bootstrap"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
archive="$bootstrap/node.$extension"
curl --fail --location --proto '=https' --proto-redir '=https' --output "$archive" "https://nodejs.org/dist/v24.22.1/node-v24.22.1-$target.$extension"
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$archive"); else actual=$(shasum -a 256 "$archive"); fi
actual=${actual%% *}
if [ "$actual" != "$hash" ]; then echo 'Private Node integrity mismatch; previous entry retained.' >&2; exit 1; fi
tar -xf "$archive" -C "$bootstrap"
node="$bootstrap/node-v24.22.1-$target/bin/node"
if [ -z "$data_home" ]; then data_home=$("$node" "$here/lifecycle.mjs" "$root"); fi
if [ "$#" -eq 5 ]; then
  if core_output=$("$node" "$here/manager.mjs" install --root "$root" --home "$data_home" --plugin "$plugin" --plugin-integrity "$integrity" --runtime-lock "$here/runtime-lock.json" --node-archive "$archive" --backend "$5"); then core_exit=0; else core_exit=$?; fi
else
  if core_output=$("$node" "$here/manager.mjs" install --root "$root" --home "$data_home" --plugin "$plugin" --plugin-integrity "$integrity" --runtime-lock "$here/runtime-lock.json" --node-archive "$archive"); then core_exit=0; else core_exit=$?; fi
fi
if [ "$core_exit" -ne 0 ]; then
  printf '{"phase":"core","result":{"state":"failed","exitCode":%s}}\n' "$core_exit"
  exit "$core_exit"
fi
printf '{"phase":"core","result":%s}\n' "$core_output"
if [ "${DSH_MODERN_SKIP_COMMUNITY:-0}" = 1 ]; then
  printf '{"phase":"community","result":{"state":"skipped"}}\n'
elif community_output=$("$node" "$here/manager.mjs" community --root "$root"); then
  printf '{"phase":"community","result":%s}\n' "$community_output"
else
  printf '{"phase":"community","result":{"state":"failed","coreRetained":true,"retry":"community --root <program-root>"}}\n'
fi
printf '{"phase":"timing","result":{"startedAt":"%s","completedAt":"%s","elapsedSeconds":%s,"nodeDownloaded":true,"clockResolutionSeconds":1}}\n' "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(($(date +%s)-epoch))"
