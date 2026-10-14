import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildDocs } from '../../scripts/docs.mjs'

describe('documentation made from the program\'s own text', () => {
  for (const [name, text] of Object.entries(buildDocs())) {
    it(`docs/${name} is what scripts/docs.mjs makes (run: node scripts/docs.mjs)`, () => {
      const file = readFileSync(join(process.cwd(), 'docs', name), 'utf8').replace(/\r\n/g, '\n')
      expect(file).toBe(text.replace(/\r\n/g, '\n'))
    })
  }
})
