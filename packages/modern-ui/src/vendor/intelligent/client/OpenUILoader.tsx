import { useEffect, useState } from 'react'
import { Button } from '../../primitives/Button.tsx'
import { CodeBlock } from '../../primitives/markdown/CodeBlock.tsx'
import { isChunkLoadError } from '../../primitives/chunk-load-error.ts'
import css from './OpenUIBlock.module.css'

type Renderer = typeof import('./OpenUIBlock.tsx').OpenUIBlock
type Props = Parameters<Renderer>[0]
/** The arrived renderer: later blocks start with it instead of painting the loading card again. */
let arrived: { Renderer: Renderer } | undefined

export function OpenUILoader(props: Props) {
  const [read, setRead] = useState<{ Renderer: Renderer } | { error: unknown } | undefined>(arrived)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void import('./OpenUIBlock.tsx').then(
      module => { arrived ??= { Renderer: module.OpenUIBlock }; if (active) setRead(arrived) },
      error => { if (active) setRead({ error }) },
    )
    return () => { active = false }
  }, [attempt])
  if (read !== undefined && 'Renderer' in read) return <read.Renderer {...props} />
  let error: Error | undefined
  if (read !== undefined) {
    if (!isChunkLoadError(read.error)) throw read.error
    error = read.error
  }
  return <section className={css.card} data-openui-block data-state={error === undefined ? 'loading' : 'load-error'}>
    <div className={css.toolbar}><strong className={css.title}>{props.t('title')}</strong></div>
    <p className={css.status} role={error === undefined ? 'status' : 'alert'}>
      {error === undefined ? props.t('preparingView') : `${props.t('partial')}: ${error.message}`}
    </p>
    {error !== undefined && <Button variant="outline" size="sm" onClick={() => { setRead(undefined); setAttempt(value => value + 1) }}>{props.t('restartView')}</Button>}
    <CodeBlock code={props.code} lang="openui-lang" {...props.labels} />
  </section>
}
