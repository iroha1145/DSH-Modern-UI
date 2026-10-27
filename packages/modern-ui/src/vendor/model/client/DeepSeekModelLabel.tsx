/** Fixed "1017" release badge on the official DeepSeek Flash entry, inside Modern's own label slot. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Tag } from '@iroha1145/dsh-modern-ui/primitives'
import css from './DeepSeekModelLabel.module.css'

/** The catalog name the official label plugin decorates; other names pass through untouched. */
const MODEL_NAME = 'DeepSeek-V4.1-Flash'
/** Release marker of that entry; a date stamp, identical in every language. */
const RELEASE_BADGE = '1017'

type DeepSeekModelLabelProps = Pick<PropsRuntime<'modern.conversation.input.model.label'>, 'provider' | 'model'>

/**
 * The official `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017` registers into the slot
 * the official model selector declares, which Modern's selector cannot render. This entry gives
 * Modern's own label slot the same decoration, in the patched quiet tone with the name yielding
 * before the badge in a narrow row.
 * @param props - provider and catalog model of the row or trigger being labelled.
 * @returns the decorated name for the recognized official Flash entry, else the catalog name.
 */
export function DeepSeekModelLabel({ provider, model }: DeepSeekModelLabelProps) {
  const official = provider.id === 'deepseek-account' || provider.id === 'deepseek-official'
  if (!official || model.id !== 'deepseek-flash' || model.name !== MODEL_NAME) return model.name
  return (
    <span className={css.label} data-model-release={RELEASE_BADGE}>
      <span className={css.name}>{model.name}</span>{' '}<Tag tone="quiet" className={css.badge}>{RELEASE_BADGE}</Tag>
    </span>
  )
}
