import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CodeBlock, type CodeBlockProps } from '../../packages/modern-ui/src/vendor/primitives/markdown/CodeBlock.tsx'
import { ReadBlock } from '../../packages/modern-ui/src/vendor/primitives/ReadBlock.tsx'
import { installHighlighting, isGrammarLoaded, requestGrammar, subscribeGrammarLoaded } from '../../packages/modern-ui/src/vendor/primitives/markdown/highlight.ts'
import { LAZY_GRAMMARS } from '../../packages/modern-ui/src/vendor/primitives/markdown/highlight-grammars.ts'

let releaseOwner: () => void
const mountOwner=()=>installHighlighting({effect: (effect:()=>()=>void)=>{releaseOwner=effect()}} as never)
mountOwner()
const app = createRoot(document.getElementById('app')!)
const labels = {
  codeLabel: 'Code',
  copy: 'Copy', copied: 'Copied', collapseAria: 'Collapse', expandAria: (n: number) => `Expand ${n}`,
  collapse: 'Collapse', expand: (n: number) => `Expand ${n}`, window: (n: number, total: number) => `${n}/${total}`,
  wrapLabel: 'Wrap', unwrapLabel: 'Unwrap',
}
Object.assign(window, {
  show(blocks: (Pick<CodeBlockProps, 'code' | 'lang' | 'streaming' | 'lineNumbers' | 'wrap' | 'toolbarLabels'> & { read?: boolean })[]) {
    flushSync(() => app.render(<>{blocks.map((block, index) => <section key={index} data-block={index}>
      {block.read ? <ReadBlock labels={labels} lines={block.code.split('\n').map((text, i) => ({ text, number: i + 1 }))} totalLines={block.code.split('\n').length} lang={block.lang} />
        : <CodeBlock {...block} copyLabel="Copy" copiedLabel="Copied" />}
    </section>)}</>))
  },
  isGrammarLoaded,
  requestGrammar,
  languages: [...LAZY_GRAMMARS.keys()],
  subscribeGrammarLoaded,
  releaseHighlightOwner:()=>releaseOwner(),
  mountHighlightOwner:mountOwner,
})
