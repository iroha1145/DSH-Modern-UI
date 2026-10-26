/** Check the frozen native loader against the private Node that will launch DSH. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const [source, destination] = process.argv.slice(2)
assert.ok(source && destination, 'Expected source and isolated fixture directories')
const lock = readFileSync(resolve(source, 'pnpm-lock.yaml'), 'utf8')
const versions = new Set([...lock.matchAll(/^  node-addon-require-builtin@(\d+\.\d+\.\d+):$/gm)].map(match => match[1]))
assert.equal(versions.size, 1, 'Expected one exact native loader version in the frozen dependency lock')
const version = [...versions][0]
const npmCli = process.platform === 'win32'
  ? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  : resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
execFileSync(process.execPath, [npmCli, 'install', '--prefix', destination, '--ignore-scripts', '--no-audit', '--no-fund', `node-addon-require-builtin@${version}`], { stdio: 'inherit' })
const require = createRequire(resolve(destination, 'package.json'))
const addon = require('node-addon-require-builtin')
const loader = addon.requireBuiltin('internal/modules/cjs/loader')
assert.equal(typeof loader.Module._resolveFilename, 'function')
console.log(`Native loader ${version} loaded under private Node ${process.versions.node} (${process.platform}/${process.arch}).`)
