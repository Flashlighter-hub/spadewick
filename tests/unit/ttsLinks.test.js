import { describe, it, expect } from 'vitest'
import { fileLink, ttsImageLink, normalizeLinkMode } from '../../src/main/ttsLinks.js'

describe('file links for Tabletop Simulator (PRD §10.2.1)', () => {
  it('writes a Windows drive path with forward slashes', () => {
    expect(fileLink('C:\\Users\\me\\exports\\my_set_face.png', 'win32')).toBe('file:///C:/Users/me/exports/my_set_face.png')
    expect(fileLink('D:/Games/cards/a.png', 'win32')).toBe('file:///D:/Games/cards/a.png')
  })

  it('keeps spaces and non-ASCII letters as they are, because TTS reads the link as a path', () => {
    expect(fileLink('C:\\Users\\Zoë Müller\\My Game Files\\a b.png', 'win32')).toBe('file:///C:/Users/Zoë Müller/My Game Files/a b.png')
  })

  it('encodes only the three characters that would change the meaning of a link', () => {
    expect(fileLink('C:\\Games\\100% #1\\what?.png', 'win32')).toBe('file:///C:/Games/100%25 %231/what%3F.png')
    expect(fileLink('/Users/me/a&b (copy)/x.png', 'darwin')).toBe('file:///Users/me/a&b (copy)/x.png')
  })

  it('writes a network path as file://server/share/…', () => {
    expect(fileLink('\\\\nas\\cards\\set\\a.png', 'win32')).toBe('file://nas/cards/set/a.png')
  })

  it('writes macOS and Linux paths as file:// plus the absolute path', () => {
    expect(fileLink('/Users/me/exports/my_set_face.png', 'darwin')).toBe('file:///Users/me/exports/my_set_face.png')
    expect(fileLink('/home/me/my game/a.png', 'linux')).toBe('file:///home/me/my game/a.png')
  })

  it('refuses a path that is not absolute, rather than writing a link that cannot work', () => {
    expect(() => fileLink('exports/a.png', 'win32')).toThrow(/full path/)
    expect(() => fileLink('a.png', 'linux')).toThrow(/full path/)
    expect(() => fileLink('C:relative.png', 'win32')).toThrow(/full path/)
    expect(() => fileLink('', 'darwin')).toThrow(/full path/)
  })

  it('builds the link for a file in the export folder, on each platform', () => {
    expect(ttsImageLink('local', 'C:\\Users\\me\\exports', 'my_set_face.png', 'win32')).toBe('file:///C:/Users/me/exports/my_set_face.png')
    expect(ttsImageLink('local', '/Users/me/exports', 'my_set_back.png', 'darwin')).toBe('file:///Users/me/exports/my_set_back.png')
    expect(ttsImageLink('local', 'C:\\Users\\me\\exports\\', 'a.png', 'win32')).toBe('file:///C:/Users/me/exports/a.png')   // a trailing slash is harmless
  })

  it('"file names only" gives the bare name, whatever the folder', () => {
    expect(ttsImageLink('names', 'C:\\Users\\me\\exports', 'my_set_face.png', 'win32')).toBe('my_set_face.png')
    expect(ttsImageLink('names', 'relative/dir', 'x.png', 'linux')).toBe('x.png')
  })

  it('treats any other setting value as the default, local', () => {
    expect(normalizeLinkMode('names')).toBe('names')
    expect(normalizeLinkMode('local')).toBe('local')
    for (const v of [undefined, null, '', 'hosted', 42]) expect(normalizeLinkMode(v)).toBe('local')
  })
})
