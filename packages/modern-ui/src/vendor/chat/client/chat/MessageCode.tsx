/** Standard assistant code-fence presentation on the shared renderer chain. */
import { CodeBlock } from '@iroha1145/dsh-modern-ui/primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Render an authored code fence with highlighting, copying, and disclosure controls.
 * @param props - Original source, language, stream state, and localized control labels.
 * @returns The standard code block.
 */
export function MessageCode({ code, lang, streaming, labels }: Pick<PropsRuntime<'conversation.chat.message.code'>, 'code' | 'lang' | 'streaming' | 'labels'>) {
  if (code === '') return <pre><code className={lang === undefined ? undefined : `language-${lang}`} /></pre>
  return <CodeBlock code={`${code}\n`} lang={lang} streaming={streaming} {...labels} />
}
