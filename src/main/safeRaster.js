/**
 * Drawing a design to a picture without risking the application.
 *
 * resvg (the drawing engine) is native code, and for some drawings it panics; a panic stops the whole process, with nothing in the log
 * (seen: a design with several drop shadows and a long unwrapped text running off the card). So user drawings are drawn in a helper
 * process (rasterWorker.js). If the helper dies, the drawing is tried again in two plainer forms, and only if all fail is there an error,
 * which names the drawing as the cause. The application itself goes on.
 *
 *   level 0  the drawing as it is
 *   level 1  each filter (drop shadow, blur) limited to a region around the card: the shadows stay
 *   level 2  filters left out
 *
 * Which level a design needed is remembered (by its definitions), so a design that crashes level 0 is not sent there again.
 */
import { fork } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Resvg } from '@resvg/resvg-js'
import { logError } from './log.js'
import { tr } from '../shared/i18n.js'

const TIMEOUT_MS = 90_000
const MAX_LEVEL = 2
const REMEMBERED = 200

class RasterCrash extends Error {}

// ---------------------------------------------------------------------------
// The helper process
// ---------------------------------------------------------------------------

/** rasterWorker.js sits beside this file in a checkout, and beside the bundle (or one level up from a chunk) once built. */
function workerFile() {
  const here = dirname(fileURLToPath(import.meta.url))
  return [join(here, 'rasterWorker.js'), join(here, '../rasterWorker.js')].find(p => existsSync(p)) ?? null
}

let child = null
let nextId = 1
let current = null          // { id, resolve, reject, timer } the one drawing the helper is busy with
let chain = Promise.resolve()

function stopChild() {
  if (!child) return
  const c = child
  child = null
  c.removeAllListeners()
  try { c.kill() } catch { /* already gone */ }
}

function failCurrent(err) {
  if (!current) return
  const { reject, timer } = current
  current = null
  clearTimeout(timer)
  reject(err)
}

function startChild(file) {
  const c = fork(file, [], {
    execArgv: ['--no-warnings'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },   // the packaged application is itself the program that runs the helper
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  c.on('message', msg => {
    if (!current || msg?.id !== current.id) return
    const { resolve, reject, timer } = current
    current = null
    clearTimeout(timer)
    if (msg.error) reject(new Error(msg.error)); else resolve(Buffer.from(msg.png))
  })
  c.on('exit', (code, signal) => {
    if (child === c) child = null
    failCurrent(new RasterCrash(`the drawing engine stopped (${signal ?? `exit code ${code}`})`))
  })
  c.on('error', err => { if (child === c) child = null; failCurrent(new RasterCrash(err.message)) })
  c.unref()
  c.channel?.unref()
  return c
}

/** One drawing in the helper. Rejects with RasterCrash when the helper dies, with a plain Error when resvg refuses the drawing. */
function inHelper(file, svg, options) {
  return new Promise((resolve, reject) => {
    if (!child) child = startChild(file)
    const id = nextId++
    const timer = setTimeout(() => { stopChild(); failCurrent(new RasterCrash('the drawing took too long')) }, TIMEOUT_MS)
    current = { id, resolve, reject, timer }
    try { child.send({ id, svg, options }) } catch (err) { stopChild(); failCurrent(new RasterCrash(err.message)) }
  })
}

process.on('exit', () => { try { child?.kill() } catch { /* ignore */ } })

// ---------------------------------------------------------------------------
// The plainer forms of a drawing
// ---------------------------------------------------------------------------

/** Level 1: every filter with a region relative to the thing it is applied to gets one in the card's own units, around the card. */
export function limitFilterRegions(svg) {
  const vb = /<svg\b[^>]*\sviewBox\s*=\s*["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(svg)
  if (!vb) return svg
  const [x, y, w, h] = vb.slice(1).map(Number)
  const region = ` filterUnits="userSpaceOnUse" x="${x - w}" y="${y - h}" width="${w * 3}" height="${h * 3}"`
  return svg.replace(/<filter\b([^>]*)>/gi, (tag, attrs) => {
    if (/\sfilterUnits\s*=\s*["']userSpaceOnUse["']/i.test(attrs)) return tag
    const cleaned = attrs.replace(/\s(?:filterUnits|x|y|width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    return `<filter${cleaned}${region}>`
  })
}

/** Level 2: no filters at all. */
export function dropFilters(svg) {
  return svg.replace(/\sfilter\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
}

const form = (svg, level) => (level === 0 ? svg : level === 1 ? limitFilterRegions(svg) : dropFilters(limitFilterRegions(svg)))

/** What a design's definitions look like (a different card of the same template has the same): the text up to the end of its `<defs>`. */
const keyOf = svg => {
  const end = svg.indexOf('</defs>')
  return createHash('sha1').update(svg.slice(0, end > 0 && end < 20000 ? end : 3000)).digest('hex')
}
const levels = new Map()
const remember = (key, level) => { levels.delete(key); levels.set(key, level); if (levels.size > REMEMBERED) levels.delete(levels.keys().next().value) }

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/**
 * Draw `svg` with the given resvg options, as a PNG buffer.
 * @param {string} svg
 * @param {object} options resvg options (plain data: they are sent to the helper)
 * @param {{ report?: object, what?: string }} [opts] `report.drawnPlainer` is set to 1 or 2 when a plainer form was needed; `what` names the drawing in the log
 * @returns {Promise<Buffer>}
 */
export function rasterize(svg, options, opts = {}) {
  const run = chain.then(() => draw(svg, options, opts))
  chain = run.catch(() => {})
  return run
}

async function draw(svg, options, { report, what } = {}) {
  const file = workerFile()
  if (!file || process.env.SPADEWICK_RASTER_IN_PROCESS === '1') return Buffer.from(new Resvg(svg, options).render().asPng())   // no helper to be had: as before
  const key = keyOf(svg)
  let level = levels.get(key) ?? 0
  for (;;) {
    try {
      const png = await inHelper(file, form(svg, level), options)
      if (level > 0) { remember(key, level); if (report) report.drawnPlainer = level }
      return png
    } catch (err) {
      if (!(err instanceof RasterCrash)) throw err
      stopChild()
      logError('raster', `${what ?? 'drawing'}: ${err.message} at level ${level}${level < MAX_LEVEL ? ', trying a plainer form' : ''}`)
      if (level >= MAX_LEVEL) throw new Error(tr('errors.renderCrashed'))
      level++
    }
  }
}
