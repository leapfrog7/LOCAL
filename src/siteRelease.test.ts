import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import packageMetadata from '../package.json'

describe('download website release details', () => {
  const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8')

  it('shows only the current package version', () => {
    const releaseVersions = [...html.matchAll(/\b\d+\.\d+\.\d+\b/g)].map(match => match[0])
    expect(new Set(releaseVersions)).toEqual(new Set([packageMetadata.version]))
  })

  it('uses stable links to the latest signed release', () => {
    expect(html).not.toMatch(/releases\/download\/v\d/)
    expect(html.match(/releases\/latest\/download\/LOCAL-latest\.apk/g)).toHaveLength(3)
    expect(html).toContain('https://github.com/leapfrog7/LOCAL/releases/latest')
  })
})
