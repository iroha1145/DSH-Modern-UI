import { useEffect, useState } from 'react'
import { isChunkLoadError } from '../chunk-load-error.ts'
import { Button } from '../Button.tsx'
import css from './MathLoad.module.css'

export interface MathLoadLabels { retry: string; failed: string }
const defaultLabels: MathLoadLabels = { retry: 'Retry loading math', failed: 'Math could not be loaded; source preserved' }
type Renderer = typeof import('./MathContent.tsx').default
/** The arrived renderer: later formulas start with it instead of painting their TeX source again. */
let arrived: { Renderer: Renderer } | undefined

function MathContent({ value, displayMode, labels = defaultLabels }: { value: string; displayMode: boolean; labels?: MathLoadLabels | undefined }) {
  const [read, setRead] = useState<{ Renderer: Renderer } | { error: unknown } | undefined>(arrived)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void import('./MathContent.tsx').then(
      module => { arrived ??= { Renderer: module.default }; if (active) setRead(arrived) },
      error => { if (active) setRead({ error }) },
    )
    return () => { active = false }
  }, [attempt])
  if (read !== undefined && 'Renderer' in read) return <read.Renderer value={value} displayMode={displayMode} />
  let error: Error | undefined
  if (read !== undefined) {
    if (!isChunkLoadError(read.error)) throw read.error
    error = read.error
  }
  const source = displayMode ? <pre className={css.source}>{value}</pre> : <span className={css.source}>{value}</span>
  return <>
    {source}
    {error !== undefined && <span className={css.failure} role="alert">{labels.failed}: {error.message} <Button variant="outline" size="sm" onClick={() => { setRead(undefined); setAttempt(value => value + 1) }}>{labels.retry}</Button></span>}
  </>
}

export function renderTexToReact(value: string, displayMode: boolean, labels?: MathLoadLabels) {
  return <MathContent value={value} displayMode={displayMode} labels={labels} />
}
