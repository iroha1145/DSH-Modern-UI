// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/** Inline exit status for a settled command. */
import { Tag } from '@iroha1145/dsh-modern-ui/primitives'
import css from './ExitCodeBadge.module.css'

/**
 * Render a neutral capsule with a failure dot and a localized exit status.
 * @param props - localized exit code or terminating signal label.
 * @returns the exit status capsule.
 */
export function ExitCodeBadge({ label }: { label: string }) {
  return (
    <Tag tone="neutral" className={css.badge}>
      <span className={css.dot} aria-hidden />
      {label}
    </Tag>
  )
}
