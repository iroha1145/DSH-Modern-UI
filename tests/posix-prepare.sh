#!/usr/bin/env bash
# Exercise downloaded runtime recovery and the shipped launcher in an isolated installation.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/dsh-posix-prepare-XXXXXXXX")"
trap 'rm -rf "$scratch"' EXIT
scratch="$(cd "$scratch" && pwd -P)"
install="$scratch/isolated install"
export npm_config_cache="$scratch/npm-cache"
prepare() { bash "$root/scripts/install.sh" --dir "$install" --prepare-only --skip-plugins "$@"; }

prepare
node="$install/runtime/node/bin/node"
printf 'retained-session\n' > "$install/data/session.jsonl"
cp "$install/data/session.jsonl" "$scratch/expected-session"
rm "$install/runtime/node/lib/node_modules/npm/bin/npm-cli.js"
prepare
test -f "$install/runtime/node/lib/node_modules/npm/bin/npm-cli.js"
prepare --force
cmp "$scratch/expected-session" "$install/data/session.jsonl"
"$node" "$root/tests/runtime-loader.mjs" "$install/dsh" "$scratch/native-loader"

# The real launcher selects its private Node; the isolated entry only reports process facts.
mkdir -p "$install/dsh/node_modules/tsx/dist/esm"
printf 'export {};\n' > "$install/dsh/node_modules/tsx/dist/esm/index.mjs"
cat > "$install/dsh/apps/cli/src/bin.ts" <<'PROBE'
import zlib from 'node:zlib'
console.log(JSON.stringify({ node: process.versions.node, brotliFixed: Object.hasOwn(zlib.constants, 'BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH'), home: process.env.DSH_HOME, args: process.argv.slice(2) }))
PROBE
cp "$root/scripts/launch.sh" "$install/dsh-ui"
cp "$install/install.conf" "$install/launch.conf"
bash "$install/dsh-ui" web --dump-default-config > "$scratch/launcher.json"
"$node" --input-type=module - "$root/dsh-ui.json" "$scratch/launcher.json" "$install/data" <<'CHECK'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const [manifestPath, outputPath, home] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const actual = JSON.parse(readFileSync(outputPath, 'utf8'))
assert.equal(actual.node, manifest.node.runtime)
assert.equal(actual.brotliFixed, true)
assert.equal(actual.home, home)
assert.deepEqual(actual.args, ['web', '--dump-default-config'])
console.log(`POSIX preparation, runtime recovery and launcher passed with Node ${actual.node}.`)
CHECK
