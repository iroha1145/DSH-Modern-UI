// biome-ignore-all lint/performance/noDynamicNamespaceImportAccess: Verify every language export; this test is never bundled into the product.
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import * as tool from '../../packages/modern-ui/src/vendor/tool/client/dictionaries.ts'
import * as conversation from '../../packages/modern-ui/src/vendor/conversation/client/locales.ts'
import corrections from '../fixtures/locale-audit-corrections.json'

const addedKeys = new Set([
  'input.failedSend',
  'input.failedSend.restore',
  'input.failedSend.discard',
  'input.failedSend.attachments',
  'input.failedSend.missingAttachments',
])

// Export values captured from the audited 5b1acbd baseline, independently of the shared source.
const baseline = {
  conversation: {
    zh: 'f6085e72bf2ffe833ee25e6e19d0bcac1a9f2e5c4123b05a982d85a976f9ab30',
    en: 'd77025e8b1418d02ac7a3f62de8129d5f5fcc1fb0ba2e70ac6898476721be78b',
    ja: '6bba57a334696df826f8a30d03d0cc945935b4a0d5d26941bedea873172046bc',
    es: '1c704d2d4ad85529ab539057b2a4d02794b4982d467bff5f421d3524b2e2d3df',
    fr: '2e9c3d0e22093cadbc0068b7a91873f304053924f047bd457bb81bba284c926c',
    de: '51513ca04cca334cb38d0620a7502858d59bb30739a513c715ff8e84c0e3eb56',
    ru: '04743fde5f92f7ee39cb7bb08eeb071bf72b95967cfac57e59bbee68b4f1a6ca',
    pt: '99020fd49352bf2f7572128b63bf710feabb4254d324a33914ccbede6f83614d',
  },
  'modern-conversation': {
    zh: 'da9bf2aae5d7ab2f671e1aec75d868cf8e00cbbe3505baf7e12e77b9aa54e2f6',
    en: '2195e59bbc6465422626eb1680820e10de99ca304503e8c5f11c92a1d1df8814',
    ja: 'f54aaee3e50657b63ed5dcf2ca71b598e4903bb74f39e4138df8836f52893596',
    es: '538bbdceb84679ec1c380286dcb682ceeb07abff3b70c7b59d2d63b8c8c37ffa',
    fr: '13c035c8e4cccbcffa103c9d6cccd7284837e00a116cc408b78507cd6e99b047',
    de: '89a560fbea4d763532df4472426eed3a78159c407fec9d80b1aea8d1fc025e91',
    ru: 'd528d53fed034692f862278893670caec0fe67358c134cb66b95aabf8c7d0b10',
    pt: 'd6f7293da58e91dadcf5976a713feef1c71fa27a892f86745b0f066f21cc29f2',
  },
} as const

test('both namespaces preserve original dictionaries apart from explicitly approved additions and corrections', () => {
  expect(tool.NS).toBe('conversation')
  expect(conversation.NS).toBe('modern-conversation')
  for (const language of ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const) {
    for (const dictionary of [tool, conversation]) {
      const changes = corrections.groups.shared.changes as Record<string, Record<string, { before: string; after: string }>>
      const entries = Object.entries(dictionary[language])
        .filter(([key]) => !addedKeys.has(key))
        .map(([key, value]) => {
          const correction = changes[language]?.[key]
          if (correction !== undefined) expect(value).toBe(correction.after)
          return [key, correction?.before ?? value]
        })
        .sort(([a], [b]) => (a as string).localeCompare(b as string, 'en'))
      expect(createHash('sha256').update(JSON.stringify(entries)).digest('hex')).toBe(baseline[dictionary.NS][language])
    }
    expect(Object.keys(tool[language]).filter(key => !addedKeys.has(key))).toHaveLength(391)
    expect(Object.keys(conversation[language]).filter(key => !addedKeys.has(key))).toHaveLength(395)
    for (const key of addedKeys) {
      expect(tool[language]).toHaveProperty(key)
      expect(conversation[language]).toHaveProperty(key)
    }
    for (const key of Object.keys(tool[language]) as (keyof typeof tool.zh)[]) expect(conversation[language][key]).toBe(tool[language][key])
  }
})
