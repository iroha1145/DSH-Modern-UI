import { renderTexToReact } from './katex.tsx'
import 'katex/dist/katex.min.css'

export default function MathContent({ value, displayMode }: { value: string; displayMode: boolean }) {
  return <>{renderTexToReact(value, displayMode)}</>
}
