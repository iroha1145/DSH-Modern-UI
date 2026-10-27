import test from 'node:test'
import assert from 'node:assert/strict'
import { auditStartupOutput } from '../../scripts/distribution/web-self-test.mjs'

// Verbatim official rc.4 loader output for a profile copied from an existing data home.
const skipped = 'dsh: skipping profile bundle "@deepseek-ai/dsh-personalized-recommendations": Error: dsh: cannot resolve profile bundle "@deepseek-ai/dsh-personalized-recommendations" from the dsh installation or /data/profiles/modern-ui-1; run \'dsh plugin --profile modern-ui-1 install\' if its dependency is not installed\n'
const ready = 'dsh web: http://127.0.0.1:49152/?token=redacted\n'

test('official skipped-bundle warnings are reported, not treated as a failed startup', () => {
  const audit = auditStartupOutput(skipped + ready)
  assert.deepEqual(audit, { skippedBundles: ['@deepseek-ai/dsh-personalized-recommendations'], problem: false })
  const twice = auditStartupOutput(skipped + skipped.replace('personalized-recommendations', 'gone-bundle') + ready)
  assert.deepEqual(twice.skippedBundles, ['@deepseek-ai/dsh-personalized-recommendations', '@deepseek-ai/dsh-gone-bundle'])
})

test('inactive entries, validation and other errors still fail the startup audit', () => {
  assert.equal(auditStartupOutput(ready).problem, false)
  assert.equal(auditStartupOutput(skipped + 'dsh: 2 entries did not activate\n' + ready).problem, true)
  assert.equal(auditStartupOutput('ValidationError: config.port expected number\n' + ready).problem, true)
  assert.equal(auditStartupOutput(ready + 'TypeError: Cannot read properties of undefined\n').problem, true)
  assert.equal(auditStartupOutput('Error: listen EADDRINUSE\n').problem, true)
})
