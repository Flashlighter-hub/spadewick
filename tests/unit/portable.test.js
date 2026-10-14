import { describe, it, expect } from 'vitest'
import { portableRoot } from '../../src/main/portable.js'

describe('portableRoot (PRD §14.3)', () => {
  it('uses the folder beside the executable on Windows and Linux', () => {
    expect(portableRoot({ platform: 'win32', execPath: 'C:/Games/Spadewick/Spadewick.exe', env: {} })).toBe('C:/Games/Spadewick')
    expect(portableRoot({ platform: 'linux', execPath: '/opt/spadewick/spadewick', env: {} })).toBe('/opt/spadewick')
  })
  it('uses the folder of the AppImage file, not its temporary mount', () => {
    expect(portableRoot({ platform: 'linux', execPath: '/tmp/.mount_abc/spadewick', env: { APPIMAGE: '/home/me/games/Spadewick.AppImage' } })).toBe('/home/me/games')
  })
  it('uses the folder beside the .app bundle on macOS', () => {
    expect(portableRoot({ platform: 'darwin', execPath: '/Users/me/Spadewick/Spadewick.app/Contents/MacOS/Spadewick', env: {} })).toBe('/Users/me/Spadewick')
  })
  it('honours the Windows portable launcher folder', () => {
    expect(portableRoot({ platform: 'win32', execPath: 'C:\\Temp\\x\\Spadewick.exe', env: { PORTABLE_EXECUTABLE_DIR: 'D:\\USB\\Spadewick' } })).toBe('D:\\USB\\Spadewick')
  })
})
