import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { startApp, axeViolations } from './harness.js'
import { seedSet, makePng } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700"><rect width="500" height="700" fill="#223355"/><text data-spadewick-id="title" x="30" y="70" font-size="40" fill="#fff">{{name}}</text></svg>'

async function project() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `a11y-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({
    fields: [{ name: 'Name', type: 'text' }, { name: 'Cost', type: 'number', validation: { min: 0, max: 10 } }, { name: 'Legendary', type: 'boolean' }, { name: 'Tint', type: 'color' }, { name: 'Art', type: 'image_ref' }, { name: 'Label', type: 'formula', formula: 'upper(name)' }],
    cards: [{ name: 'Orc', fields: { name: 'Orc', cost: '3', tint: '#cc3333' } }, { name: 'Elf', fields: { name: 'Elf', cost: '2', legendary: 'true' } }], template: { svg: SVG }
  })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  await app.invoke('assets:import', [await makePng(join(app.root, 'a.png'), 40, 40, '#44aa88')])
  return s
}

async function setTheme(theme) {
  await app.invoke('settings:set', 'theme', theme)
}

const SCREENS = {
  'welcome screen': async () => { await app.invoke('projects:close'); await app.goto(); await app.page.waitForSelector('text=New Project') },
  'card table': async () => { await project(); await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row'); await app.page.locator('.cell[data-col="name"]').first().click(); await app.page.waitForSelector('.preview-pane img, img') },
  'template editor with canvas': async () => { await project(); await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Template Editor")'); await app.page.locator('.template-list .tpl').first().click(); await app.page.waitForSelector('.template-editor canvas'); await app.page.locator('.stage-view canvas').last().click({ position: { x: 40, y: 60 } }) },
  'asset browser': async () => { await project(); await app.goto(); await app.page.click('button[role=tab]:has-text("Assets")'); await app.page.locator('.asset-card').first().click() },
  'snapshots': async () => { await project(); await app.invoke('snapshots:create', { name: 'one' }); await app.goto(); await app.page.click('button[role=tab]:has-text("Snapshots")'); await app.page.waitForSelector('.panel li') }
}

// The source dialog of PRD §8.7.1 opens from the template editor
SCREENS['template source dialog'] = async () => { await SCREENS['template editor with canvas'](); await app.page.click('button:has-text("View source")'); await app.page.waitForSelector('[role=dialog] textarea.svg-source') }

const DIALOGS = {
  'fields dialog': () => app.menu('menu:manage-fields'),
  'find and replace': () => app.menu('menu:find-replace'),
  'preferences': () => app.menu('menu:preferences'),
  'fonts': () => app.menu('menu:manage-fonts'),
  'card ids': () => app.menu('menu:card-ids'),
  'new set': async () => { await app.holdPrompts(true); await app.page.locator('.sidebar .add-btn').first().click() },
  'about': () => app.menu('menu:about'),
  'export': () => app.menu('menu:export-pdf'),
  'csv import': async () => { await app.page.click('button[title="Import CSV or JSON"]') },
  'csv export': async () => { await app.page.click('button[title="Export CSV or JSON"]') },
  // these two live in the Template Editor, so they come last
  'new template': async () => { await app.holdPrompts(true); await app.page.click('button[role=tab]:has-text("Template Editor")'); await app.page.click('button[aria-label="New template"]') },
  'template library': async () => { await app.page.click('button[role=tab]:has-text("Template Editor")'); await app.page.click('button:has-text("Library…")') }
}

for (const theme of ['dark', 'light']) {
  describe(`accessibility (axe, WCAG 2.1 AA) — ${theme} theme`, () => {
    beforeAll(async () => { await setTheme(theme) })

    for (const [name, show] of Object.entries(SCREENS)) {
      it(name, async () => {
        await show()
        await app.page.waitForFunction(t => document.documentElement.getAttribute('data-theme') === t, theme)
        expect(await axeViolations(app.page)).toEqual([])
      })
    }

    describe('dialogs', () => {
      beforeAll(async () => { await project(); await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row') })
      for (const [name, open] of Object.entries(DIALOGS)) {
        it(name, async () => {
          await open()
          await app.page.waitForSelector('[role=dialog]')
          expect(await axeViolations(app.page)).toEqual([])
          await app.page.keyboard.press('Escape')
          await app.page.waitForFunction(() => !document.querySelector('[role=dialog]'))
        })
      }
    })
  })
}

describe('accessibility: more states (axe)', () => {
  beforeAll(async () => { await setTheme('dark'); await project(); await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row') })

  it('asset picker dialog', async () => {
    await app.page.locator('.cell[data-col="art"]').first().locator('.image-btn').click()
    await app.page.waitForSelector('[role=dialog]')
    expect(await axeViolations(app.page)).toEqual([])
    await app.page.keyboard.press('Escape')
  })

  it('colour popup and row context menu', async () => {
    await app.page.locator('.cell[data-col="tint"]').first().locator('.swatch-btn').click()
    await app.page.waitForSelector('.popup')
    expect(await axeViolations(app.page)).toEqual([])
    await app.page.keyboard.press('Escape')
    await app.page.locator('.cell[data-col="name"]').first().click({ button: 'right' })
    await app.page.waitForSelector('.ctx-menu')
    expect(await axeViolations(app.page)).toEqual([])
    await app.page.keyboard.press('Escape')
  })

  it('find & replace with a results table, and the import mapping table', async () => {
    await app.menu('menu:find-replace')
    await app.page.fill('[role=dialog] input.grow >> nth=0', 'Orc'); await app.page.fill('[role=dialog] input.grow >> nth=1', 'Ork')
    await app.page.click('[role=dialog] button:has-text("Preview")')
    await app.page.waitForSelector('[role=dialog] table tbody tr')
    expect(await axeViolations(app.page)).toEqual([])
    await app.page.keyboard.press('Escape')
    const csv = join(app.root, 'a11y.csv'); (await import('fs')).writeFileSync(csv, 'name,cost,extra\nTroll,x,1\n')
    app.mockDialog.open(csv)
    await app.page.click('button[title="Import CSV or JSON"]')
    await app.page.click('button:has-text("Choose CSV file")')
    await app.page.waitForSelector('table.map'); await app.page.waitForSelector('.report')
    expect(await axeViolations(app.page)).toEqual([])
    await app.page.keyboard.press('Escape')
  })

  it('every export tab', async () => {
    await app.menu('menu:export-tts'); await app.page.waitForSelector('[role=dialog]')
    for (const tab of ['Tabletop Simulator', 'Print PDF', 'PNG Sheet']) {
      await app.page.click(`[role=tab]:has-text("${tab}")`)
      expect(await axeViolations(app.page)).toEqual([])
    }
    await app.page.click('[role=tab]:has-text("Print PDF")')
    await app.page.check('text=Manual grid'); await app.page.selectOption('#pdf-page-size', 'custom')
    expect(await axeViolations(app.page)).toEqual([])
    await app.page.keyboard.press('Escape')
  })

  it('error toast and unsaved-changes indicator', async () => {
    await app.page.locator('.cell[data-col="cost"]').first().dblclick()
    await app.page.locator('.cell-editor').fill('99'); await app.page.keyboard.press('Enter')
    await app.page.waitForSelector('.toast')
    expect(await axeViolations(app.page)).toEqual([])
  })
})

describe('keyboard operation and focus management (PRD §14.4)', () => {
  beforeAll(async () => { await setTheme('dark'); await project(); await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row') })

  it('opening a dialog moves focus into it, Tab stays inside, Escape returns focus to the opener', async () => {
    const opener = app.page.locator('button[title="Manage fields"]')
    await opener.focus(); await app.page.keyboard.press('Enter')
    await app.page.waitForSelector('[role=dialog]')
    expect(await app.page.evaluate(() => !!document.activeElement.closest('[role=dialog]'))).toBe(true)
    for (let i = 0; i < 40; i++) {
      await app.page.keyboard.press('Tab')
      expect(await app.page.evaluate(() => !!document.activeElement.closest('[role=dialog]'))).toBe(true)
    }
    for (let i = 0; i < 40; i++) {
      await app.page.keyboard.press('Shift+Tab')
      expect(await app.page.evaluate(() => !!document.activeElement.closest('[role=dialog]'))).toBe(true)
    }
    await app.page.keyboard.press('Escape')
    await app.page.waitForFunction(() => !document.querySelector('[role=dialog]'))
    expect(await app.page.evaluate(() => document.activeElement?.getAttribute('title'))).toBe('Manage fields')
  })

  it('the app behind a dialog is inert and hidden from assistive technology', async () => {
    await app.menu('menu:about'); await app.page.waitForSelector('[role=dialog]')
    expect(await app.page.evaluate(() => document.querySelector('.app-shell').hasAttribute('inert'))).toBe(true)
    expect(await app.page.getAttribute('.app-shell', 'aria-hidden')).toBe('true')
    expect(await app.page.getAttribute('[role=dialog]', 'aria-modal')).toBe('true')
    expect(await app.page.evaluate(() => { const d = document.querySelector('[role=dialog]'); return !!document.getElementById(d.getAttribute('aria-labelledby'))?.textContent })).toBe(true)
    await app.page.keyboard.press('Escape')
    await app.page.waitForFunction(() => !document.querySelector('.app-shell').hasAttribute('inert'))
  })

  it('stacked dialogs release the background only when the last one closes', async () => {
    await app.page.locator('.cell[data-col="art"]').first().locator('.image-btn').click()
    await app.page.waitForSelector('[role=dialog]')
    expect(await app.page.evaluate(() => document.querySelector('.app-shell').hasAttribute('inert'))).toBe(true)
    await app.page.keyboard.press('Escape')
    await app.page.waitForFunction(() => !document.querySelector('.app-shell').hasAttribute('inert'))
  })

  it('tab order follows reading order: navigation, then views, then the table', async () => {
    await app.page.evaluate(() => document.activeElement?.blur())
    const order = []
    for (let i = 0; i < 60; i++) {
      await app.page.keyboard.press('Tab')
      order.push(await app.page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const region = el.closest('nav') ? 'nav' : el.closest('main') ? 'main' : el.closest('[role=region]') ? 'status' : 'other'
        return region
      }))
    }
    const seq = order.filter(Boolean)
    const firstMain = seq.indexOf('main')
    expect(seq.indexOf('nav')).toBeLessThan(firstMain)                  // sidebar before workspace
    expect(seq.slice(0, firstMain).every(r => r === 'nav')).toBe(true)  // no jumping back and forth
    expect(seq.slice(firstMain).includes('nav')).toBe(false)
  })

  it('the view tabs are a proper tab list: roving focus with arrow keys, Home and End', async () => {
    await app.page.locator('[role=tab][aria-selected=true]').focus()
    await app.page.keyboard.press('ArrowRight')
    expect(await app.page.getAttribute('[role=tab][aria-selected=true]', 'id')).toBe('tab-template')
    expect(await app.page.evaluate(() => document.activeElement.id)).toBe('tab-template')
    expect(await app.page.getAttribute('[role=tabpanel]', 'aria-labelledby')).toBe('tab-template')
    await app.page.keyboard.press('End')
    expect(await app.page.getAttribute('[role=tab][aria-selected=true]', 'id')).toBe('tab-help')
    await app.page.keyboard.press('ArrowRight')
    expect(await app.page.getAttribute('[role=tab][aria-selected=true]', 'id')).toBe('tab-cards')
    expect(await app.page.locator('[role=tab][tabindex="-1"]').count()).toBe(7)
  })

  it('the card table can be driven entirely from the keyboard', async () => {
    await app.page.locator('.card-grid').focus()
    await app.page.keyboard.press('ArrowDown')
    for (let i = 0; i < 4; i++) await app.page.keyboard.press('ArrowRight')   // ID → template → card back → quantity → first field
    await app.page.keyboard.type('Keyboard'); await app.page.keyboard.press('Enter')
    await app.page.waitForFunction(() => document.querySelector('.grid-row .cell[data-col="name"]').innerText === 'Keyboard')
  })

  it('every control that is not a text field has an accessible name', async () => {
    const unnamed = await app.page.evaluate(() => [...document.querySelectorAll('button, [role=button], select, input:not([type=hidden])')]
      .filter(el => !el.closest('[inert]') && el.offsetParent !== null)
      .filter(el => !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent.trim() || el.labels?.length || el.title || el.getAttribute('placeholder')))
      .map(el => el.outerHTML.slice(0, 100)))
    expect(unnamed).toEqual([])
  })
})

describe('colour is never the only signal (PRD §14.4)', () => {
  beforeAll(async () => { await setTheme('dark'); await project(); await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row') })
  const shadow = sel => app.page.evaluate(s => getComputedStyle(document.querySelector(s)).boxShadow, sel)

  it('selected rows carry an edge bar and aria-selected, not just a tint', async () => {
    await app.page.locator('.row-handle').first().click()
    expect(await app.page.getAttribute('.grid-row.selected', 'aria-selected')).toBe('true')
    expect(await shadow('.grid-row.selected')).not.toBe('none')
    expect(await shadow('.grid-row:not(.selected)')).toBe('none')
  })

  it('the current set and view are marked with aria-current, bold text and an edge bar', async () => {
    expect(await app.page.getAttribute('.set-item', 'aria-current')).toBe('true')
    expect(await app.page.evaluate(() => getComputedStyle(document.querySelector('.set-row.active')).fontWeight)).toBe('700')
    expect(await shadow('.set-row.active')).not.toBe('none')
  })

  it('errors use an icon and words as well as colour', async () => {
    await app.page.locator('.cell[data-col="cost"]').first().dblclick()
    await app.page.locator('.cell-editor').fill('99'); await app.page.keyboard.press('Enter')
    const toast = await app.page.locator('.toast.error').innerText()
    expect(toast).toMatch(/⚠/); expect(toast).toMatch(/above the maximum/)
  })

  it('shows unsaved template changes in words', async () => {
    await app.page.click('button[role=tab]:has-text("Template Editor")')
    await app.page.locator('.template-list .tpl').first().click()
    await app.page.click('button:has-text("View source")')
    await app.page.locator('textarea.svg-source').fill(SVG + '<!-- edited -->')
    await app.page.click('[role=dialog] button:has-text("Done")')
    await app.page.waitForSelector('.unsaved')
    expect(await app.page.locator('.unsaved').innerText()).toMatch(/Unsaved changes/)
  })
})

describe('operating-system accessibility preferences (PRD §14.4)', () => {
  beforeAll(async () => { await setTheme('dark'); await project(); await app.goto(); await app.page.click('.set-item'); await app.page.waitForSelector('.grid-row') })

  it('forced colours (Windows High Contrast): selection and the active cell stay visible as outlines', async () => {
    await app.page.emulateMedia({ forcedColors: 'active' })
    await app.page.locator('.row-handle').first().click()
    await app.page.locator('.cell[data-col="name"]').first().click()
    const outline = await app.page.evaluate(() => ({
      row: getComputedStyle(document.querySelector('.grid-row.selected')).outlineStyle,
      cell: getComputedStyle(document.querySelector('.cell.active')).outlineStyle,
      button: getComputedStyle(document.querySelector('.toolbar button')).borderTopStyle
    }))
    expect(outline).toEqual({ row: 'solid', cell: 'solid', button: 'solid' })
    await app.page.emulateMedia({ forcedColors: 'none' })
  })

  it('"more contrast" strengthens borders and secondary text', async () => {
    const read = () => app.page.evaluate(() => ({ border: getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim(), dim: getComputedStyle(document.documentElement).getPropertyValue('--color-text-dim').trim() }))
    const normal = await read()
    await app.page.emulateMedia({ contrast: 'more' })
    const more = await read()
    expect(more.border).not.toBe(normal.border)
    expect(more.dim).not.toBe(normal.dim)
    await app.page.emulateMedia({ contrast: 'no-preference' })
  })

  it('reduced motion switches animations and transitions off', async () => {
    await app.page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await app.page.evaluate(() => getComputedStyle(document.querySelector('.icon-btn, button')).transitionDuration)).toMatch(/^0s$/)
    await app.page.emulateMedia({ reducedMotion: 'no-preference' })
  })

  it('has a visible focus indicator on keyboard focus', async () => {
    await app.page.locator('.toolbar button').first().focus()
    await app.page.keyboard.press('Tab')
    const outline = await app.page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) } })
    expect(outline.style).not.toBe('none'); expect(outline.width).toBeGreaterThanOrEqual(2)
  })
})
