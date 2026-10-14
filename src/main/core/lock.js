/**
 * Who has a project open for writing (PRD §21.4). The application writes a lock file when it opens a project and removes it when the
 * project is closed; a command that writes to a project (import, restoring a snapshot) does the same while it runs, and refuses to start
 * when another running program holds the lock, unless it is told to go ahead. A lock whose program is no longer running is ignored,
 * so a crash leaves nothing behind that gets in the way. Reading never looks at the lock.
 */
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'

export const LOCK_FILE = '.spadewick.lock'
const lockPath = dir => join(dir, LOCK_FILE)

const alive = pid => {
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }   // EPERM: it exists, we may not signal it
}

/** The other running program that has the project open for writing, or null. */
export function holder(dir) {
  try {
    if (!existsSync(lockPath(dir))) return null
    const info = JSON.parse(readFileSync(lockPath(dir), 'utf8'))
    return info.pid && info.pid !== process.pid && alive(info.pid) ? info : null
  } catch { return null }
}

/** Take the lock (best effort: a project folder that cannot be written to simply has no lock). */
export function acquire(dir, owner) {
  try { writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, owner, since: Date.now() })) } catch { /* nothing to lock */ }
}

/** Let go of the lock, if it is ours. */
export function release(dir) {
  try {
    const info = JSON.parse(readFileSync(lockPath(dir), 'utf8'))
    if (info.pid === process.pid) rmSync(lockPath(dir), { force: true })
  } catch { /* none, or not ours */ }
}
