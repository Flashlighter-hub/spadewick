/**
 * Where a portable install keeps its data (PRD §4, §14.3): next to the application the user copied,
 * never in the OS profile folders. The folder depends on how the app is packaged.
 */
import { dirname, posix } from 'path'

export function portableRoot({ platform = process.platform, execPath = process.execPath, env = process.env } = {}) {
  // Linux AppImage: the executable lives in a temporary read-only mount; the AppImage file is what the user moved
  if (env.APPIMAGE) return dirname(env.APPIMAGE)
  // Windows portable builds expose their real folder
  if (env.PORTABLE_EXECUTABLE_DIR) return env.PORTABLE_EXECUTABLE_DIR
  // macOS: <folder>/Spadewick.app/Contents/MacOS/Spadewick → <folder>
  // (macOS paths are always POSIX, so resolve them as such: the same answer whichever system computes it)
  if (platform === 'darwin') return posix.resolve(execPath, '../../../..')
  return dirname(execPath)
}
