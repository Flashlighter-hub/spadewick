/**
 * Reading a command line (PRD §21.3). Flags may come before or after the command; `--name=value` and `--name value` both work.
 * A flag the command line does not know is a usage error, so a typo never silently does something else.
 */

/** name -> 'bool' | 'value' | 'multi' (a value that may be given several times) */
export const FLAGS = {
  project: 'value', json: 'bool', quiet: 'bool', verbose: 'bool', 'no-color': 'bool', 'dry-run': 'bool', help: 'bool', version: 'bool',
  out: 'value', set: 'multi', cards: 'value', profile: 'value', preset: 'value', opt: 'multi', options: 'value', library: 'value',
  card: 'value', side: 'value', format: 'value', width: 'value', 'only-errors': 'bool', 'export-anyway': 'bool', 'ignore-file-problems': 'bool',
  force: 'bool', mode: 'value', key: 'value', mapping: 'value', description: 'value', runs: 'value', interval: 'value', also: 'multi', reimport: 'value', sheet: 'value'
}

export class UsageError extends Error {}

export function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') { positional.push(...argv.slice(i + 1)); break }
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const eq = arg.indexOf('=')
    const name = arg.slice(2, eq === -1 ? undefined : eq)
    const kind = FLAGS[name]
    if (!kind) throw new UsageError(`Unknown option --${name}`)
    if (kind === 'bool') {
      if (eq !== -1) throw new UsageError(`--${name} takes no value`)
      flags[name] = true
      continue
    }
    let value = eq === -1 ? argv[++i] : arg.slice(eq + 1)
    if (value === undefined) throw new UsageError(`--${name} needs a value`)
    if (kind === 'multi') (flags[name] ??= []).push(value)
    else flags[name] = value
  }
  return { command: positional[0] ?? null, positional: positional.slice(1), flags }
}

/** `key=value` options (`--opt dpi=600`): numbers, true, false and null are read as such, anything else is text. */
export function parseOpts(list = []) {
  const out = {}
  for (const item of list) {
    const eq = item.indexOf('=')
    if (eq < 1) throw new UsageError(`--opt expects key=value, got "${item}"`)
    const key = item.slice(0, eq), raw = item.slice(eq + 1)
    out[key] = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw
  }
  return out
}
