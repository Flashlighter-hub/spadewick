/**
 * The drawing engine, in a process of its own (see safeRaster.js). resvg is native code: for some drawings it panics, and a panic stops
 * the whole process it runs in. Here that only costs this helper, which the application starts again.
 * Messages: { id, svg, options } in, { id, png } or { id, error } out.
 */
import { Resvg } from '@resvg/resvg-js'

process.on('message', msg => {
  const { id, svg, options } = msg ?? {}
  try {
    const png = new Resvg(svg, options).render().asPng()
    process.send({ id, png })
  } catch (err) {
    process.send({ id, error: err?.message ?? String(err) })
  }
})

// the application is gone: do not stay behind
process.on('disconnect', () => process.exit(0))
