/**
 * Run by `npm run dist` after packaging: proves the packaged app can load its database module.
 *
 * A packaged app that carries better-sqlite3 built for the wrong runtime starts, shows its window and then
 * fails on the first project it touches ("Error invoking remote method 'projects:create'", Fixes F5). So the
 * packaged Electron binary itself is asked to load the packaged native file: if the ABI does not match, it throws.
 */
import { execFileSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

const dist = join(process.cwd(), 'dist')

/** The unpacked app folder and its executable, for whichever platform was packaged. */
function findPackaged() {
  const candidates = [
    { dir: 'win-unpacked', exe: 'Spadewick.exe', resources: 'resources' },
    { dir: 'linux-unpacked', exe: 'spadewick', resources: 'resources' }
  ]
  for (const name of existsSync(dist) ? readdirSync(dist) : []) {
    if (name.startsWith('mac')) candidates.push({ dir: name, exe: 'Spadewick.app/Contents/MacOS/Spadewick', resources: 'Spadewick.app/Contents/Resources' })
  }
  return candidates
    .map(c => ({ exe: join(dist, c.dir, c.exe), native: join(dist, c.dir, c.resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node') }))
    .filter(c => existsSync(c.exe))
}

const found = findPackaged()
if (!found.length) {
  console.error('verify-package: no packaged app found in dist/. Run `npm run dist` first.')
  process.exit(1)
}

let failed = false
for (const { exe, native } of found) {
  if (!existsSync(native)) { console.error(`verify-package: the database module is missing from ${exe}`); failed = true; continue }
  try {
    // ELECTRON_RUN_AS_NODE makes the packaged binary behave as its own Node, with Electron's module ABI
    execFileSync(exe, ['-e', `require(${JSON.stringify(native)}); console.log('ok')`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe' })
    console.log(`verify-package: ${exe} loads its database module.`)
  } catch (err) {
    console.error(`verify-package: ${exe} cannot load its database module:\n${String(err.stderr || err.message).split('\n').slice(0, 4).join('\n')}`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
