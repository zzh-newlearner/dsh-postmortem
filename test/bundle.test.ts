import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('DSH bundle distribution', () => {
  it('ships a Loader patch that inserts the plugin with deterministic defaults', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(patch).toContain('- insert:')
    expect(patch).toContain("id: postmortem")
    expect(patch).toContain("name: '@huichangzz/dsh-postmortem'")
    expect(patch).toContain('autoOnFailure: detected')
  })
})
