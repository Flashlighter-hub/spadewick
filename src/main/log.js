/**
 * Minimal error log (PRD §12.2 Help → Open Logs Folder). One file, rotated at 1 MB, kept in the
 * application's own data folder so nothing is written outside it.
 */
import { appendFileSync, mkdirSync, statSync, renameSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

const MAX_BYTES = 1024 * 1024
let logsDir = null

export function setLogsDir(dir) { logsDir = dir }
export function getLogsDir() { return logsDir }

export function logError(context, err) {
  if (!logsDir) return
  try {
    mkdirSync(logsDir, { recursive: true })
    const file = join(logsDir, 'spadewick.log')
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      rmSync(join(logsDir, 'spadewick.log.1'), { force: true })
      renameSync(file, join(logsDir, 'spadewick.log.1'))
    }
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    appendFileSync(file, `${new Date().toISOString()} [${context}] ${message}\n`)
  } catch { /* logging must never break the app */ }
}
