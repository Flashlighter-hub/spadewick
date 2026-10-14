import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'
const svg = readFileSync('build/icon.svg')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = []
for (const s of sizes) pngs.push(await sharp(svg, { density: 384 }).resize(s, s).png().toBuffer())
writeFileSync('build/icon.png', await sharp(svg, { density: 384 }).resize(512, 512).png().toBuffer())
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const dir = [], body = []
sizes.forEach((s, i) => {
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12)
  offset += pngs[i].length; dir.push(e); body.push(pngs[i])
})
writeFileSync('build/icon.ico', Buffer.concat([head, ...dir, ...body]))
console.log('ok')
