export const chatContractVersions = ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.2-rc.1']

export function chatContract(version) {
  if (!chatContractVersions.includes(version)) throw new Error(`Unsupported chat contract version: ${version}; supported: ${chatContractVersions.join(', ')}`)
  return version === '0.2.2-rc.1' ? 'non-reply' : 'compact-answer'
}
