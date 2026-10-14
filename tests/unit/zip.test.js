import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { execFileSync } from 'child_process'
import { writeZip, extractZip, listZip, crc32 } from '../../src/main/zip.js'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zip-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (rel, data) => { const f = join(dir, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, data); return f }

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('round-trips text, binary, empty and unicode-named files', () => {
    const files = {
      'a.txt': 'héllo '.repeat(5000), 'sub/deep/b.bin': randomBytes(70000), 'empty.dat': '', 'ünï/名前.txt': 'x'
    }
    const entries = Object.entries(files).map(([name, data]) => ({ name, file: put('src/' + name, data) }))
    writeZip(join(dir, 'o.zip'), entries)
    extractZip(join(dir, 'o.zip'), join(dir, 'out'))
    for (const [name, data] of Object.entries(files)) expect(readFileSync(join(dir, 'out', name)).equals(Buffer.from(data))).toBe(true)
  })

  it('compresses compressible data and stores already-compressed formats', () => {
    const text = put('t.txt', 'abc'.repeat(10000))
    const png = put('p.png', randomBytes(5000))
    writeZip(join(dir, 'o.zip'), [{ name: 't.txt', file: text }, { name: 'p.png', file: png }])
    const [t, p] = listZip(join(dir, 'o.zip'))
    expect(t.method).toBe(8); expect(t.csize).toBeLessThan(t.usize / 10)
    expect(p.method).toBe(0)
  })

  it('produces archives that standard tools accept', () => {
    writeZip(join(dir, 'o.zip'), [{ name: 'a.txt', file: put('a.txt', 'hello') }])
    expect(() => execFileSync('unzip', ['-tq', join(dir, 'o.zip')])).not.toThrow()
  })

  it('rejects entries that escape the destination (zip-slip)', () => {
    writeZip(join(dir, 'o.zip'), [{ name: '../evil.txt', file: put('a.txt', 'x') }])
    expect(() => extractZip(join(dir, 'o.zip'), join(dir, 'out'))).toThrow(/unsafe/i)
  })

  it('detects corruption', () => {
    writeZip(join(dir, 'o.zip'), [{ name: 'a.txt', file: put('a.txt', 'hello world '.repeat(100)) }])
    const buf = readFileSync(join(dir, 'o.zip'))
    buf[40] ^= 0xff // flip a byte inside the data
    writeFileSync(join(dir, 'bad.zip'), buf)
    expect(() => extractZip(join(dir, 'bad.zip'), join(dir, 'out'))).toThrow()
  })

  it('rejects files that are not zips', () => {
    expect(() => listZip(put('x.zip', 'not a zip file at all, just text'))).toThrow(/valid ZIP/i)
  })
})
