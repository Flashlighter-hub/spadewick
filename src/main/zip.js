/**
 * Minimal ZIP reader/writer (PRD §11.1 snapshots). No dependencies, so the portable build stays small.
 * Supports stored and deflate entries, UTF-8 names, CRC verification and zip-slip protection.
 * ZIP64 is not supported (snapshots over 4 GB are rejected).
 */
import { openSync, closeSync, writeSync, readSync, readFileSync, writeFileSync, mkdirSync, fstatSync } from 'fs'
import { join, dirname, resolve, sep, extname } from 'path'
import { deflateRawSync, inflateRawSync } from 'zlib'
import { tr } from '../shared/i18n.js'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const ALREADY_COMPRESSED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.zip'])
const MAX = 0xffffffff

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/**
 * Write `entries` ([{ name, file }], names use forward slashes) into a new zip at `zipPath`.
 * Files are read one at a time, so memory use is bounded by the largest single file.
 */
export function writeZip(zipPath, entries) {
  const fd = openSync(zipPath, 'w')
  const central = []
  let offset = 0
  const { time, date } = dosDateTime()
  const put = buf => { writeSync(fd, buf); offset += buf.length }

  try {
    for (const { name, file } of entries) {
      const raw = readFileSync(file)
      const deflated = ALREADY_COMPRESSED.has(extname(name).toLowerCase()) ? null : deflateRawSync(raw, { level: 6 })
      const useDeflate = deflated && deflated.length < raw.length
      const data = useDeflate ? deflated : raw
      const method = useDeflate ? 8 : 0
      const nameBuf = Buffer.from(name, 'utf8')
      const crc = crc32(raw)
      if (raw.length > MAX || offset > MAX || entries.length > 0xffff) throw new Error(tr('errors.zipTooLarge'))

      const header = Buffer.alloc(30)
      header.writeUInt32LE(0x04034b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(0x0800, 6)       // UTF-8 names
      header.writeUInt16LE(method, 8)
      header.writeUInt16LE(time, 10)
      header.writeUInt16LE(date, 12)
      header.writeUInt32LE(crc, 14)
      header.writeUInt32LE(data.length, 18)
      header.writeUInt32LE(raw.length, 22)
      header.writeUInt16LE(nameBuf.length, 26)
      central.push({ nameBuf, method, crc, csize: data.length, usize: raw.length, offset })
      put(header); put(nameBuf); put(data)
    }

    const cdStart = offset
    for (const e of central) {
      const h = Buffer.alloc(46)
      h.writeUInt32LE(0x02014b50, 0)
      h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6)
      h.writeUInt16LE(0x0800, 8)
      h.writeUInt16LE(e.method, 10)
      h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14)
      h.writeUInt32LE(e.crc, 16)
      h.writeUInt32LE(e.csize, 20); h.writeUInt32LE(e.usize, 24)
      h.writeUInt16LE(e.nameBuf.length, 28)
      h.writeUInt32LE(e.offset, 42)
      put(h); put(e.nameBuf)
    }
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10)
    eocd.writeUInt32LE(offset - cdStart, 12)
    eocd.writeUInt32LE(cdStart, 16)
    put(eocd)
  } finally {
    closeSync(fd)
  }
}

function readAt(fd, position, length) {
  const buf = Buffer.alloc(length)
  let got = 0
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, position + got)
    if (n === 0) throw new Error(tr('errors.zipEnd'))
    got += n
  }
  return buf
}

/** List the entries of a zip: [{ name, method, csize, usize, crc, offset }] */
export function listZip(zipPath) {
  const fd = openSync(zipPath, 'r')
  try {
    const size = fstatSync(fd).size
    const tailLen = Math.min(size, 22 + 0xffff)
    const tail = readAt(fd, size - tailLen, tailLen)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    if (eocd < 0) throw new Error(tr('errors.zipInvalid'))
    const count = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    const cd = readAt(fd, cdOffset, cdSize)
    const out = []
    let p = 0
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(tr('errors.zipDirectory'))
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32)
      out.push({
        name: cd.toString('utf8', p + 46, p + 46 + nameLen),
        method: cd.readUInt16LE(p + 10), crc: cd.readUInt32LE(p + 16),
        csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24), offset: cd.readUInt32LE(p + 42)
      })
      p += 46 + nameLen + extraLen + commentLen
    }
    return out
  } finally {
    closeSync(fd)
  }
}

/**
 * Read some entries of a zip into memory: { name -> Buffer } for the entries whose name `pick` accepts. The same safeguards as extractZip:
 * each entry is inflated no further than the size it declares, the declared sizes together stay under `maxTotalBytes`, and the checksum is verified.
 */
export function readZipEntries(zipPath, pick, { maxTotalBytes = 256 * 1024 * 1024 } = {}) {
  const entries = listZip(zipPath).filter(e => !e.name.endsWith('/') && pick(e.name))
  if (entries.reduce((n, e) => n + e.usize, 0) > maxTotalBytes) throw new Error(tr('errors.zipTooBig'))
  const out = new Map()
  const fd = openSync(zipPath, 'r')
  try {
    for (const e of entries) {
      const local = readAt(fd, e.offset, 30)
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(tr('errors.zipEntry'))
      const dataStart = e.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      const stored = readAt(fd, dataStart, e.csize)
      if (e.method !== 0 && e.method !== 8) throw new Error(tr('errors.zipCompression', { name: e.name }))
      let data
      try { data = e.method === 8 ? inflateRawSync(stored, { maxOutputLength: Math.max(1, e.usize) }) : stored } catch { throw new Error(tr('errors.zipChecksum', { name: e.name })) }
      if (data.length !== e.usize || crc32(data) !== e.crc) throw new Error(tr('errors.zipChecksum', { name: e.name }))
      out.set(e.name, data)
    }
  } finally {
    closeSync(fd)
  }
  return out
}

/** A zip held in memory: `entries` is [{ name, data: Buffer }]. For small files made by the program (a spreadsheet); snapshots use writeZip. */
export function zipBuffer(entries) {
  const { time, date } = dosDateTime()
  const parts = []
  const central = []
  let offset = 0
  for (const { name, data: raw } of entries) {
    const deflated = deflateRawSync(raw, { level: 6 })
    const useDeflate = deflated.length < raw.length
    const data = useDeflate ? deflated : raw
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(raw)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x0800, 6)
    header.writeUInt16LE(useDeflate ? 8 : 0, 8)
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(date, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(raw.length, 22)
    header.writeUInt16LE(nameBuf.length, 26)
    central.push({ nameBuf, method: useDeflate ? 8 : 0, crc, csize: data.length, usize: raw.length, offset })
    parts.push(header, nameBuf, data)
    offset += header.length + nameBuf.length + data.length
  }
  const cdStart = offset
  for (const e of central) {
    const h = Buffer.alloc(46)
    h.writeUInt32LE(0x02014b50, 0)
    h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6)
    h.writeUInt16LE(0x0800, 8)
    h.writeUInt16LE(e.method, 10)
    h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14)
    h.writeUInt32LE(e.crc, 16)
    h.writeUInt32LE(e.csize, 20); h.writeUInt32LE(e.usize, 24)
    h.writeUInt16LE(e.nameBuf.length, 28)
    h.writeUInt32LE(e.offset, 42)
    parts.push(h, e.nameBuf)
    offset += h.length + e.nameBuf.length
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10)
  eocd.writeUInt32LE(offset - cdStart, 12)
  eocd.writeUInt32LE(cdStart, 16)
  parts.push(eocd)
  return Buffer.concat(parts)
}

/**
 * Extract every file in the zip under `destDir`. Entries that would escape `destDir` are rejected.
 * `limits` ({ maxEntries, maxTotalBytes }) guard against hostile archives (PRD §14.7): both are
 * checked against the directory before anything is written, and each entry is inflated no further
 * than the size it declares, so an archive cannot claim a small size and expand into a large one.
 */
export function extractZip(zipPath, destDir, limits = {}) {
  const entries = listZip(zipPath)
  if (limits.maxEntries != null && entries.length > limits.maxEntries) throw new Error(tr('errors.zipTooManyFiles', { max: limits.maxEntries }))
  if (limits.maxTotalBytes != null && entries.reduce((n, e) => n + e.usize, 0) > limits.maxTotalBytes) throw new Error(tr('errors.zipTooBig'))
  const root = resolve(destDir)
  const fd = openSync(zipPath, 'r')
  try {
    for (const e of entries) {
      if (e.name.endsWith('/')) continue
      const target = resolve(root, e.name)
      if (target !== root && !target.startsWith(root + sep)) throw new Error(tr('errors.zipUnsafePath', { name: e.name }))
      const local = readAt(fd, e.offset, 30)
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(tr('errors.zipEntry'))
      const dataStart = e.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      const stored = readAt(fd, dataStart, e.csize)
      if (e.method !== 0 && e.method !== 8) throw new Error(tr('errors.zipCompression', { name: e.name }))
      let data
      try { data = e.method === 8 ? inflateRawSync(stored, { maxOutputLength: Math.max(1, e.usize) }) : stored } catch { throw new Error(tr('errors.zipChecksum', { name: e.name })) }
      if (data.length !== e.usize || crc32(data) !== e.crc) throw new Error(tr('errors.zipChecksum', { name: e.name }))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
    }
  } finally {
    closeSync(fd)
  }
}

