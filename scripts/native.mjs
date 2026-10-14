/**
 * Runs after `npm install`. The app (Electron) and the tests (plain Node) need better-sqlite3 built
 * for different runtimes, and there is room for only one build in build/Release. So the Node build
 * stays where better-sqlite3 puts it, and the Electron build is downloaded (prebuilt, no compiler)
 * into prebuilt/electron, where src/main/db.js picks it up when running under Electron.
 *
 * Nothing here may fail the install: if the download is not possible, say how to fix it and go on.
 */
import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'

const require = createRequire(import.meta.url)
const root = process.cwd()
const sqlite = join(root, 'node_modules', 'better-sqlite3')
const nodeBuild = join(sqlite, 'build', 'Release', 'better_sqlite3.node')
const target = join(sqlite, 'prebuilt', 'electron', 'better_sqlite3.node')

// Electron 42's package has no install hook of its own, so `npm install` leaves node_modules/electron
// without its binary and `npm run dev` stops with "Electron uninstall". Run its installer here.
function ensureElectronBinary() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1' || process.argv.includes('--node-only')) return
  const dir = join(root, 'node_modules', 'electron')
  if (existsSync(join(dir, 'path.txt'))) return
  execFileSync(process.execPath, [join(dir, 'install.js')], { cwd: dir, stdio: 'inherit' })
  console.log('Spadewick: the Electron binary is ready.')
}

function main() {
  if (process.env.SPADEWICK_SKIP_NATIVE === '1') return
  if (!existsSync(sqlite) || !existsSync(join(root, 'node_modules', 'electron', 'package.json'))) return
  ensureElectronBinary()
  const electron = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
  const installer = require.resolve('prebuild-install/bin.js', { paths: [sqlite] })

  // prebuild-install writes into build/Release, so fetch one runtime's build at a time. Node's build
  // goes last: it is the one that stays in build/Release (the tests use it, and so does anything that
  // runs plain Node). Packaging with electron-builder replaces it with an Electron build, which is why
  // `npm run dist` calls this script again afterwards.
  const fetchBuild = (...args) => execFileSync(process.execPath, [installer, ...args, '--force'], { cwd: sqlite, stdio: 'inherit' })
  if (!process.argv.includes('--node-only')) {
    fetchBuild('--runtime', 'electron', '--target', electron)
    mkdirSync(join(sqlite, 'prebuilt', 'electron'), { recursive: true })
    copyFileSync(nodeBuild, target)
    console.log(`Spadewick: better-sqlite3 for Electron ${electron} is ready.`)
  }
  // `--electron-only` is for packaging: leave the Electron build in build/Release for electron-builder to pack
  // (it is re-fetched every time, so a stale build left by an earlier step can never be packed by mistake)
  if (process.argv.includes('--electron-only')) return
  fetchBuild()
}

try { main() } catch (err) {
  // Packaging must stop here: an exe built without the Electron build of better-sqlite3 cannot open projects
  if (process.argv.includes('--electron-only')) { console.error(`\nSpadewick: cannot package without the Electron build of better-sqlite3 (${err.message.split('\n')[0]}).`); process.exit(1) }
  console.warn(`\nSpadewick: could not fetch Electron or its better-sqlite3 build (${err.message.split('\n')[0]}).`)
  console.warn('The tests still work. To run the app, check your internet connection and run: npm run native\n')
}
