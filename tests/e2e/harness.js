/**
 * End-to-end harness: the real renderer bundle runs in Chromium, the app's real preload script is
 * evaluated in the page, and every `ipcRenderer.invoke` is forwarded over HTTP to the real
 * main-process handlers (real SQLite, sharp and resvg). Only the Electron shell itself is absent.
 */
import http from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { chromium } from 'playwright-core'
import { registerIpcHandlers } from '../../src/main/ipc/index.js'
import { onProjectChange } from '../../src/main/core/changes.js'
import { invoke, mockDialog } from '../helpers/electron-mock.js'
import { makeStore } from '../helpers/project.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

const OUT = join(process.cwd(), 'out')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }

const toWire = v => JSON.stringify(v)

function bridgeScript() {
  const preload = readFileSync(join(OUT, 'preload/index.js'), 'utf8')
  return `(() => {
    const listeners = {}
    const revive = v => {
      if (v && typeof v === 'object') {
        if (v.type === 'Buffer' && Array.isArray(v.data)) return Uint8Array.from(v.data)   // Buffer.toJSON() shape, as Electron would deliver bytes
        for (const k of Object.keys(v)) v[k] = revive(v[k])
      }
      return v
    }
    const __electron = {
      contextBridge: { exposeInMainWorld: (name, api) => { window[name] = api } },
      ipcRenderer: {
        invoke: async (channel, ...args) => {
          window.__pending = (window.__pending || 0) + 1      // lets tests wait until every IPC call has finished
          try {
            const res = await fetch('/__ipc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel, args }) })
            const body = await res.json()
            if (body.error) throw new Error(body.error)
            return revive(body.result)
          } finally { window.__pending -= 1 }
        },
        on: (ch, fn) => { (listeners[ch] ||= new Set()).add(fn) },
        off: (ch, fn) => listeners[ch]?.delete(fn)
      }
    }
    window.__emitMenu = (ch, ...args) => (listeners[ch] ? [...listeners[ch]].forEach(fn => fn({}, ...args)) : null)
    const module = { exports: {} }
    const exports = module.exports
    const require = n => { if (n === 'electron') return __electron; throw new Error('unexpected require: ' + n) }
    ${preload}
  })()`
}

let handlersRegistered = false

export async function startApp() {
  const root = mkdtempSync(join(tmpdir(), 'spadewick-e2e-'))
  if (!handlersRegistered) { registerIpcHandlers(makeStore(root)); handlersRegistered = true }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/__ipc') {
      let body = ''
      for await (const chunk of req) body += chunk
      const { channel, args } = JSON.parse(body)
      try {
        const result = await invoke(channel, ...args)
        res.setHeader('content-type', 'application/json'); res.end(toWire({ result: result ?? null }))
      } catch (err) {
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: err.message }))
      }
      return
    }
    const rel = req.url === '/' ? 'renderer/index.html' : 'renderer' + req.url.split('?')[0]
    const file = join(OUT, rel)
    if (!existsSync(file)) { res.statusCode = 404; return res.end() }
    res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file))
  }).listen(0)

  // CHROMIUM_PATH lets any environment point at its own browser; otherwise use the sandbox's, then Playwright's
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
  await context.addInitScript(bridgeScript())
  const page = await context.newPage()
  page.setDefaultTimeout(8000)

  // Native prompt()/confirm()/alert() are answered from a queue the test fills in
  const answers = []
  const dialogs = []
  let declineConfirms = 0
  const window_holdConfirms = { on: false }
  page.on('dialog', async d => {
    dialogs.push({ type: d.type(), message: d.message(), native: true })   // the application asks nothing with the browser's own dialogs
    if (d.type() === 'prompt') { const next = answers.shift(); next === undefined ? await d.dismiss() : await d.accept(String(next)) }
    else if (declineConfirms > 0) { declineConfirms--; await d.dismiss() }
    else await d.accept()
  })

  // The app asks for text with its own dialog (Electron has no window.prompt). Answer it from the same queue.
  await context.exposeFunction('__nextAnswer', () => (answers.length ? String(answers.shift()) : null))
  // Yes-or-no questions are the application's own dialog too (the browser's confirm() is not used): answered yes, unless the test declined it
  await context.exposeFunction('__confirmAnswer', message => {
    dialogs.push({ type: 'confirm', message })
    if (window_holdConfirms.on) return null
    if (declineConfirms > 0) { declineConfirms--; return false }
    return true
  })
  await context.addInitScript(() => {
    const answerPrompt = async form => {
      if (window.__holdPrompts) return     // a test that wants to look at the dialog itself
      const answer = await window.__nextAnswer()
      if (answer === null) { form.querySelector('button[type=button]').click(); return }
      const input = form.querySelector('input')
      input.value = answer; input.dispatchEvent(new Event('input', { bubbles: true }))
      form.querySelector('button[type=submit]').click()
    }
    const answerConfirm = async form => {
      if (form.dataset.asked) return                 // the dialog moves into the page's body: it is seen again, but is one question
      form.dataset.asked = '1'
      const message = form.querySelector('.message')?.textContent ?? ''
      const yes = await window.__confirmAnswer(message)
      if (yes === null) return                // a test that wants to look at the dialog itself
      form.querySelector(yes ? '[data-confirm-yes]' : '[data-confirm-no]').click()
    }
    new MutationObserver(records => {
      for (const r of records) for (const n of r.addedNodes) {
        const form = n.nodeType === 1 && (n.matches?.('[data-confirm-dialog]') ? n : n.querySelector?.('[data-confirm-dialog]'))
        if (form) answerConfirm(form)
      }
    }).observe(document, { childList: true, subtree: true })
    new MutationObserver(records => {
      for (const r of records) for (const n of r.addedNodes) {
        const form = n.nodeType === 1 && (n.matches?.('[data-prompt-dialog]') ? n : n.querySelector?.('[data-prompt-dialog]'))
        if (form) answerPrompt(form)
      }
    }).observe(document, { childList: true, subtree: true })
  })

  // what the application's main process tells its window when the project changes (UPDATES U6), told to the page the same way
  const stopChanges = onProjectChange(change => { page.evaluate(c => window.__emitMenu?.('project:changed', c), change).catch(() => { /* the page is closing */ }) })

  const errors = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`) })

  const url = `http://localhost:${server.address().port}/`
  const settleNow = async () => { try { await page.waitForFunction(() => !window.__pending, null, { timeout: 5000 }); await page.evaluate(() => new Promise(r => setTimeout(r, 30))); await page.waitForFunction(() => !window.__pending, null, { timeout: 5000 }) } catch { /* page not loaded yet */ } }
  return {
    page, root, errors, dialogs, mockDialog, url, context,
    /**
     * Another window of the application, as a second player's: it has no project of its own (it says there is none), and counts what it
     * asks the application to draw (`window.__renders`), so a test can see that a guest at a shared table draws nothing itself.
     */
    newGuestPage: async () => {
      const guest = await context.newPage()
      guest.setDefaultTimeout(8000)
      await guest.addInitScript(() => {
        window.__renders = 0
        const api = window.spadewick
        api.projects.getMeta = async () => null
        api.projects.listRecent = async () => []
        const render = api.templates.render
        api.templates.render = (...a) => { window.__renders++; return render(...a) }
        const preview = api.assets.getPreview
        api.assets.getPreview = (...a) => { window.__renders++; return preview(...a) }
      })
      guest.on('pageerror', e => errors.push(`guest pageerror: ${e.message}`))
      guest.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`guest console: ${m.text()}`) })
      await guest.goto(url)
      return guest
    },
    /** Wait until the UI has no IPC calls in flight (so the database reflects what the user just did). */
    settle: async () => { try { await page.waitForFunction(() => !window.__pending, null, { timeout: 5000 }); await page.evaluate(() => new Promise(r => setTimeout(r, 30))); await page.waitForFunction(() => !window.__pending, null, { timeout: 5000 }) } catch { /* page not loaded */ } },
    /** Call a handler directly, without waiting for the UI (use for bulk seeding). */
    raw: invoke,
    /** Read state through the real handlers, after pending UI work has landed. */
    invoke: async (...a) => { await settleNow(); return invoke(...a) },
    /** Queue answers for the next window.prompt() calls. */
    answer: (...values) => answers.push(...values),
    goto: async () => { await page.goto(url); await page.waitForSelector('#app, body') },
    /** Pretend the OS menu item was clicked. */
    declineNextConfirm: () => { declineConfirms++ },
    holdPrompts: on => page.evaluate(v => { window.__holdPrompts = v }, on),
    /** Leave the next yes-or-no question on screen, to look at it (and answer it with the buttons). */
    holdConfirms: on => { window_holdConfirms.on = on },
    menu: (channel, ...args) => page.evaluate(([c, a]) => window.__emitMenu(c, ...a), [channel, args]),
    /** Edit a card-table cell the way a user does: double-click, type, Enter. */
    edit: async (row, col, value) => {
      await page.locator('.grid-row').nth(row).locator(`.cell[data-col="${col}"]`).dblclick()
      const editor = page.locator('.cell-editor')
      await editor.fill(value)
      await editor.press('Enter')
      await editor.waitFor({ state: 'detached' })
      await settleNow()
    },
    cellText: (row, col) => page.locator('.grid-row').nth(row).locator(`.cell[data-col="${col}"]`).innerText(),
    toast: () => page.locator('.toasts .toast').allInnerTexts(),
    close: async () => {
      stopChanges()
      await invoke('projects:close').catch(() => {})
      await browser.close(); server.close(); rmSync(root, { recursive: true, force: true })
    }
  }
}

/**
 * Run the axe-core accessibility engine against the current page (WCAG 2.0/2.1 A + AA).
 * Returns the violations as short readable strings; an empty list means the page passed.
 */
export async function axeViolations(page, { include } = {}) {
  const source = readFileSync(join(process.cwd(), 'node_modules/axe-core/axe.min.js'), 'utf8')
  await page.evaluate(src => { if (!window.axe) (0, eval)(src) }, source)
  const results = await page.evaluate(async ctx => {
    const out = await window.axe.run(ctx ? document.querySelector(ctx) : document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      resultTypes: ['violations']
    })
    return out.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map(n => n.target.join(' ') + (n.any?.[0]?.message ? ' — ' + n.any[0].message : '')) }))
  }, include ?? null)
  return results.map(v => `${v.impact} ${v.id}: ${v.help}\n    ${v.nodes.join('\n    ')}`)
}
