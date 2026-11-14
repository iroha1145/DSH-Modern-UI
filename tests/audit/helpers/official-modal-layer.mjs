import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/** Bundle the published modal stack without starting unrelated syntax-highlighter workers in Node. */
export function officialModalLayerPlugin() {
  const require = createRequire(import.meta.url)
  const source = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-primitives'), 'utf8')
  const regions = ['keyboard-composition', 'focus', 'useModalLayer'].map(name => {
    const start = source.indexOf(`//#region lib/types/${name}.js`)
    const end = source.indexOf('//#endregion', start)
    assert.ok(start >= 0 && end > start, `Official ${name} region is present`)
    return source.slice(start, end)
  })
  return {
    name: 'official-modal-layer',
    setup(builder) {
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'modal-layer', namespace: 'official-layer' }))
      builder.onLoad({ filter: /.*/, namespace: 'official-layer' }, () => ({
        contents: `import {useRef,useLayoutEffect} from 'react'; ${regions.join('\n')} export {useModalLayer,isBehindModal,closeTopModal};`,
        loader: 'js',
      }))
    },
  }
}
