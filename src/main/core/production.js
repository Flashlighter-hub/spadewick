/** Production export (PRD §17): the service functions over the engine in `src/main/production/`. */
import * as engine from '../production/engine.js'
import { runImages } from '../production/images.js'

export const run = (ctx, opts) => engine.run(ctx, opts ?? {})
export const runImagesService = (ctx, opts) => runImages(ctx, opts ?? {})
export const proof = (ctx, opts) => engine.proof(ctx, opts ?? {})
export const status = () => engine.status()
export const cancel = () => engine.cancel()
