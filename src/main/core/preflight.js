/** Print preflight (PRD §17.7): the service functions over the engine in `src/main/preflight/`. */
import * as engine from '../preflight/engine.js'

export const run = (ctx, opts) => engine.run(ctx, opts ?? {})
export const getMinimums = ctx => engine.getMinimums(ctx)
export const setMinimums = (ctx, input) => engine.setMinimums(ctx, input)
export const defaultMinimums = () => engine.defaultMinimums()
