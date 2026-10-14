/**
 * The command line (PRD §21): `runCli(argv, io)` returns the exit code and never exits the process itself, so a test or another
 * program can call it. `index.js` is the entry that exits with that code.
 *
 *   0 done · 1 the check ran and found problems · 2 wrong usage · 3 the project cannot be opened (or is damaged)
 */
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { createContext, createMemorySettings } from '../main/core/session.js'
import { projectHandle } from '../main/core/context.js'
import { openProjectDb, closeProjectDb, checkIntegrity, SchemaTooNewError } from '../main/db.js'
import { parseArgs, UsageError } from './args.js'
import { COMMANDS, HELP, NOT_BUILT, needsWrite } from './commands.js'
import { holder, acquire, release } from '../main/core/lock.js'

export const EXIT = { OK: 0, PROBLEMS: 1, USAGE: 2, PROJECT: 3 }

const appVersion = () => {
  try { return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version } catch { return '2.0.0' }
}

/**
 * @param {string[]} argv the arguments after the program name
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, cwd?: string, env?: object }} [io]
 */
export async function runCli(argv, io = {}) {
  const out = io.stdout ?? (s => process.stdout.write(s))
  const err = io.stderr ?? (s => process.stderr.write(s))
  const cwd = io.cwd ?? process.cwd()
  const env = io.env ?? process.env
  let ctx = null
  let locked = false

  try {
    const { command, positional, flags } = parseArgs(argv)
    if (flags.version || command === 'version') { out(`${appVersion()}\n`); return EXIT.OK }
    if (flags.help || !command || command === 'help') { out(HELP); return command || flags.help ? EXIT.OK : EXIT.USAGE }
    if (NOT_BUILT.includes(command)) throw new UsageError(`"${command}" is not available in this version of the command line. Run "help" for the commands there are.`)
    const run = COMMANDS[command]
    if (!run) throw new UsageError(`Unknown command "${command}". Run "help" for the commands there are.`)

    const projectDir = resolve(cwd, flags.project ?? '.')
    if (!existsSync(join(projectDir, 'project.db'))) {
      err(`${flags.project ? `"${projectDir}"` : 'The current folder'} is not a Spadewick project (no project.db). Use --project <folder>.\n`)
      return EXIT.PROJECT
    }
    const library = flags.library ?? env.SPADEWICK_LIBRARY ?? join(homedir(), '.spadewick', 'library')
    ctx = createContext({ settings: createMemorySettings({ projects_root: resolve(projectDir, '..'), library_dir: resolve(cwd, library), default_export_dpi: 300, undo_limit: 1000, recent_projects: [] }) })

    try {
      const db = openProjectDb(projectDir)
      if (checkIntegrity(db) !== true) {
        closeProjectDb(projectDir)
        err('The project database is damaged. Open the project in Spadewick to restore a snapshot; the command line does not attempt recovery.\n')
        return EXIT.PROJECT
      }
    } catch (e) {
      err(`${e instanceof SchemaTooNewError ? e.message : `The project cannot be opened: ${e.message}`}\n`)
      return EXIT.PROJECT
    }
    ctx.project = projectHandle(projectDir)

    // A command that writes takes the lock, and does not start while another running program has the project open (PRD §21.4)
    if (needsWrite(command, positional, flags)) {
      const other = holder(projectDir)
      if (other && !flags.force) {
        err(`The project is open in another program (${other.owner === 'app' ? 'the Spadewick application' : 'another command'}, process ${other.pid}). Close it, or run again with --force to write anyway.\n`)
        return EXIT.PROJECT
      }
      if (!other) { acquire(projectDir, 'cli'); locked = true }   // a lock that is not ours is left as it is
    }

    if (!flags.quiet && !flags.json && flags.verbose) err(`Project: ${projectDir}\n`)
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGINT', stop)
    let result
    try { result = await run(ctx, { positional, flags, log: line => (flags.json ? err : out)(`${line}\n`), signal: controller.signal }) } finally { process.off('SIGINT', stop) }
    out(flags.json ? `${JSON.stringify(result.data, null, 2)}\n` : `${result.text}\n`)
    return result.exit
  } catch (e) {
    if (e instanceof UsageError) { err(`${e.message}\n`); return EXIT.USAGE }
    err(`${e.message}\n`)
    return EXIT.PROBLEMS
  } finally {
    if (ctx?.project) { if (locked) release(ctx.project.dir); closeProjectDb(ctx.project.dir) }
  }
}
