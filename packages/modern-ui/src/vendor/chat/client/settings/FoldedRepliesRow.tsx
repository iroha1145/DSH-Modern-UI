/** General Settings row for which Assistant replies stay visible once a Turn folds. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FOLDED_REPLIES, type FoldedReplies } from '../../chat-settings.ts'
import type { ChatKey } from '../locale.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

/** Registration-side preference face. */
export interface FoldedRepliesRowInjected {
  hooks: {
    /** Persisted folded-reply choice bound as useFoldedReplies. */
    foldedReplies: SnapshotStore<FoldedReplies>
  }
  /** Persist which Assistant replies stay visible in a folded Turn. */
  setFoldedReplies: (replies: FoldedReplies) => void
}

/** Full Settings-row props. */
export type FoldedRepliesRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'modern-chat'>
  & InjectFace<FoldedRepliesRowInjected>

const LABELS = {
  all: 'settings.foldedReplies.all',
  final: 'settings.foldedReplies.final',
} as const satisfies Record<FoldedReplies, ChatKey>

/**
 * Render the folded-reply selector. The official general settings own the work-details
 * mode and collapse timing; this preference has no field in the official chat schema, so
 * the plugin keeps it in its own settings namespace.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function FoldedRepliesRow({ useFoldedReplies, setFoldedReplies, t }: FoldedRepliesRowProps) {
  const replies = useFoldedReplies(value => value)
  return (
    <PreferenceRow
      title={t('settings.foldedReplies.title')}
      description={t('settings.foldedReplies.description')}
      value={replies}
      selectedLabel={t(LABELS[replies])}
      options={FOLDED_REPLIES.map(id => ({ id, label: t(LABELS[id]) }))}
      onSelect={value => { setFoldedReplies(value as FoldedReplies) }}
    />
  )
}
