export const chatContractVersions = ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.2-rc.1', '0.2.2-rc.2']
// 0.2.2 publishes hasNonReplyProcess where 0.2.1 published compactAnswer.
const nonReply = new Set(['0.2.2-rc.1', '0.2.2-rc.2'])

export function chatContract(version) {
  if (!chatContractVersions.includes(version)) throw new Error(`Unsupported chat contract version: ${version}; supported: ${chatContractVersions.join(', ')}`)
  return nonReply.has(version) ? 'non-reply' : 'compact-answer'
}
