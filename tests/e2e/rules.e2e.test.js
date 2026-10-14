/**
 * The Rules (PRD §7.11): writing the rules of the game as pages of Markdown, the tree of pages, formatting, references to cards, pictures
 * and pages, and import and export.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { startApp, axeViolations } from './harness.js'
import { seedSet } from '../helpers/project.js'
import { makePng } from '../helpers/project.js'

let app
beforeAll(async () => { app = await startApp() })
afterAll(async () => { await app.close() })
beforeEach(() => { app.errors.length = 0 })

const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700">${inner}</svg>`

async function freshProject() {
  await app.invoke('projects:close').catch(() => {})
  await app.invoke('projects:create', { name: `rules-${Date.now()}`, parentDir: app.root })
  const s = await seedSet({ name: 'Base', cardSize: 'poker', fields: [{ name: 'Title', type: 'text' }], template: { svg: svg('<rect width="500" height="700" fill="#336699"/>') }, cards: [{ name: 'Fire Bolt' }, { name: 'Ice' }] })
  await app.invoke('sets:update', { id: s.set.id, defaultTemplateId: s.template.id })
  return s
}
const open = async () => { await app.goto(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Rules")'); await app.page.waitForSelector('.rules') }
const text = () => app.page.locator('textarea.text')
const preview = () => app.page.locator('article.md')
const titles = async () => (await app.invoke('rules:list')).map(p => p.title)
const treeItems = () => app.page.locator('[role=treeitem]')
const addPage = async title => {
  await app.page.click('.pages .bar button:has-text("New page")')
  await app.page.waitForFunction(() => document.activeElement?.id === 'rules-title')
  await app.page.keyboard.type(title)
  await app.page.keyboard.press('Enter')
  await app.page.waitForFunction(t => [...document.querySelectorAll('[role=treeitem]')].some(n => n.textContent.trim() === t), title)
}
const shows = value => expect.poll(() => text().inputValue(), { timeout: 5000 }).toBe(value)
const subpage = async (title) => {
  await app.page.click('.pages .bar button:has-text("New subpage")')
  await app.page.waitForFunction(() => document.activeElement?.id === 'rules-title')
  await app.page.keyboard.type(title); await app.page.keyboard.press('Enter')
  await app.page.waitForFunction(t => [...document.querySelectorAll('[role=treeitem]')].some(n => n.textContent.trim() === t), title)
}
const settled = async () => { await app.page.waitForSelector('.status:has-text("Saved")'); await app.settle() }

describe('pages', () => {
  it('starts empty, makes a page, names it, and writes in it: the page reads as it is written, and is kept', async () => {
    await freshProject(); await open()
    expect(await app.page.locator('.empty').innerText()).toContain('The rules of your game')
    await addPage('Overview')
    await expect.poll(() => treeItems().allInnerTexts(), { timeout: 5000 }).toEqual(['Overview'])
    await text().fill('# Welcome\n\nA **fast** card game for 2–4 players.\n\n- Draw\n- Play')
    expect(await preview().locator('h1').innerText()).toBe('Welcome')
    expect(await preview().locator('strong').innerText()).toBe('fast')
    expect(await preview().locator('ul li').allInnerTexts()).toEqual(['Draw', 'Play'])
    await settled()
    const [p] = await app.invoke('rules:list')
    expect((await app.invoke('rules:get', p.id)).body).toBe('# Welcome\n\nA **fast** card game for 2–4 players.\n\n- Draw\n- Play')
    expect(await axeViolations(app.page)).toEqual([])
  })

  it('what was written is there when the page is opened again, after another tab, and after the app is opened again', async () => {
    await freshProject(); await open()
    await addPage('First'); await text().fill('first text'); await settled()
    await addPage('Second'); await text().fill('second text')                      // not yet saved when the next page is opened
    await app.page.locator('[role=treeitem]', { hasText: 'First' }).click()
    await shows('first text')
    await app.page.locator('[role=treeitem]', { hasText: 'Second' }).click()
    await shows('second text')
    await text().fill('second text, changed')
    await app.page.click('button[role=tab]:has-text("Card Data")')                    // leaving the tab saves
    await app.page.click('button[role=tab]:has-text("Rules")')
    await app.page.locator('[role=treeitem]', { hasText: 'Second' }).click()
    await shows('second text, changed')
    await app.page.reload(); await app.page.click('.set-item'); await app.page.click('button[role=tab]:has-text("Rules")')
    await app.page.locator('[role=treeitem]', { hasText: 'Second' }).click()
    await shows('second text, changed')
  })

  it('renames a page from the title box', async () => {
    await freshProject(); await open()
    await addPage('Old name')
    await app.page.locator('#rules-title').fill('New name')
    await app.page.locator('#rules-title').press('Enter')
    await app.page.waitForFunction(() => document.querySelector('[role=treeitem]')?.textContent.trim() === 'New name')
    expect(await titles()).toEqual(['New name'])
  })

  it('makes subpages, folds them, and moves a page up, down, in and out', async () => {
    await freshProject(); await open()
    await addPage('A'); await addPage('B'); await addPage('C')
    await app.page.locator('[role=treeitem]', { hasText: 'B' }).click()
    await subpage('B1')
    await expect.poll(() => treeItems().allInnerTexts(), { timeout: 5000 }).toEqual(['A', 'B', 'B1', 'C'])
    expect(await app.page.locator('[role=treeitem]', { hasText: 'B1' }).getAttribute('aria-level')).toBe('2')
    await app.page.locator('button[aria-label="Fold B"]').click()
    await expect.poll(() => treeItems().allInnerTexts(), { timeout: 5000 }).toEqual(['A', 'B', 'C'])
    await app.page.locator('button[aria-label="Unfold B"]').click()

    await app.page.locator('[role=treeitem]', { hasText: 'C' }).click()
    await app.page.click('button[aria-label="Move up"]')
    await expect.poll(() => treeItems().allInnerTexts(), { timeout: 5000 }).toEqual(['A', 'C', 'B', 'B1'])
    await app.page.click('button[aria-label="Make it a subpage of the page above"]')
    await app.page.waitForFunction(() => document.querySelectorAll('[role=treeitem]')[1]?.getAttribute('aria-level') === '2')
    await expect.poll(() => treeItems().allInnerTexts(), { timeout: 5000 }).toEqual(['A', 'C', 'B', 'B1'])        // C is below A now (a subpage of A)
    await app.page.click('button[aria-label="Move it out to the level of its parent"]')
    await app.page.waitForFunction(() => document.querySelectorAll('[role=treeitem]')[1]?.getAttribute('aria-level') === '1')
    await app.page.click('button[aria-label="Move down"]')
    await expect.poll(() => treeItems().allInnerTexts(), { timeout: 5000 }).toEqual(['A', 'B', 'B1', 'C'])
    const tree = await app.invoke('rules:list')
    expect(tree.find(p => p.title === 'B1').parent_id).toBe(tree.find(p => p.title === 'B').id)
  })

  it('deletes a page after asking, with the pages below it, and the page next to it is shown', async () => {
    await freshProject(); await open()
    await addPage('A'); await addPage('B')
    app.declineNextConfirm()
    await app.page.click('button:text-is("Delete")')
    expect(await titles()).toEqual(['A', 'B'])                                       // declined
    await app.page.click('button:text-is("Delete")')
    await app.page.waitForFunction(() => document.querySelectorAll('[role=treeitem]').length === 1)
    expect(await titles()).toEqual(['A'])
    expect(await app.page.locator('#rules-title').inputValue()).toBe('A')
    expect(app.dialogs.at(-1).message).toContain('Delete the page “B”?')
  })

  it('can be driven from the keyboard: arrows move in the list and fold the pages', async () => {
    await freshProject(); await open()
    await addPage('A'); await addPage('B')
    await app.page.locator('[role=treeitem]', { hasText: 'A' }).click()
    await subpage('A1')
    await app.page.locator('[role=treeitem]', { hasText: /^A$/ }).focus()
    await app.page.keyboard.press('ArrowDown')
    expect(await app.page.evaluate(() => document.activeElement.textContent.trim())).toBe('A1')
    await app.page.keyboard.press('ArrowLeft')
    expect(await app.page.evaluate(() => document.activeElement.textContent.trim())).toBe('A')
    await app.page.keyboard.press('ArrowLeft')
    await expect.poll(() => treeItems().allInnerTexts(), { timeout: 5000 }).toEqual(['A', 'B'])
    await app.page.keyboard.press('ArrowRight')
    await expect.poll(() => treeItems().allInnerTexts(), { timeout: 5000 }).toEqual(['A', 'A1', 'B'])
  })
})

describe('writing', () => {
  async function onePage(body = '') {
    await freshProject(); await open(); await addPage('P')
    if (body) await text().fill(body)
  }
  const select = (from, to) => text().evaluate((t, [a, b]) => { t.focus(); t.setSelectionRange(a, b) }, [from, to])

  it('formats with the toolbar: bold, italic, headings, lists, a table, a rule', async () => {
    await onePage('word')
    await select(0, 4)
    await app.page.click('.format button[aria-label="bold"]')
    expect(await text().inputValue()).toBe('**word**')
    await app.page.keyboard.press('Control+i')
    expect(await text().inputValue()).toBe('***word***')
    await text().fill('one\ntwo'); await select(0, 7)
    await app.page.click('.format button[aria-label="Bulleted list"]')
    expect(await text().inputValue()).toBe('- one\n- two')
    await app.page.click('.format button[aria-label="Bulleted list"]')
    expect(await text().inputValue()).toBe('one\ntwo')
    await app.page.click('.format button[aria-label="Numbered list"]')
    expect(await text().inputValue()).toBe('1. one\n2. two')
    await text().fill('Title'); await select(0, 0)
    await app.page.click('.format button[aria-label="Heading 2"]')
    expect(await text().inputValue()).toBe('## Title')
    await app.page.click('.format button[aria-label="Heading 1"]')
    expect(await text().inputValue()).toBe('# Title')
    await text().fill(''); await app.page.click('.format button[aria-label="Table"]')
    expect(await preview().locator('table th').allInnerTexts()).toEqual(['Name', 'Value'])
    await app.page.click('.format button[aria-label="Rule"]')
    expect(await preview().locator('hr').count()).toBe(1)
  })

  it('reads the whole of the supported Markdown: quotes, code, task lists, tables with alignment', async () => {
    await onePage('> quoted\n\n`code` and ~~gone~~\n\n- [x] done\n- [ ] open\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n```\nblock\n```')
    expect(await preview().locator('blockquote').innerText()).toBe('quoted')
    expect(await preview().locator('code').first().innerText()).toBe('code')
    expect(await preview().locator('del').innerText()).toBe('gone')
    expect(await preview().locator('li.task input[checked]').count()).toBe(1)
    expect(await preview().locator('th.al-center').count()).toBe(1)
    expect(await preview().locator('td.al-right').innerText()).toBe('2')
    expect(await preview().locator('pre code').innerText()).toBe('block')
  })

  it('never lets what is written run: HTML and scripts are shown as text', async () => {
    await onePage('<script>window.__x = 1</script> <img src=x onerror="window.__y = 1"> [bad](javascript:window.__z=1)')
    expect(await preview().locator('script, img').count()).toBe(0)
    expect(await app.page.evaluate(() => [window.__x, window.__y, window.__z])).toEqual([undefined, undefined, undefined])
    expect(await preview().innerText()).toContain('<script>')
    expect(await preview().locator('.dead-link').innerText()).toBe('bad')
  })

  it('switches between writing, both, and reading', async () => {
    await onePage('# Hi')
    await app.page.click('.modes button:text-is("Write")')
    expect(await preview().count()).toBe(0)
    expect(await text().count()).toBe(1)
    await app.page.click('.modes button:text-is("Read")')
    expect(await text().count()).toBe(0)
    expect(await app.page.locator('.format').count()).toBe(0)
    expect(await preview().locator('h1').innerText()).toBe('Hi')
    await app.page.click('.modes button:text-is("Both")')
    expect(await text().count()).toBe(1)
    expect(await preview().count()).toBe(1)
  })

  it('Ctrl+Z in the text goes back in the text, not in the project', async () => {
    await onePage()
    await text().click()
    await app.page.keyboard.type('hello')
    await app.menu('menu:undo')
    expect(await text().inputValue()).not.toBe('hello')
    expect(await titles()).toEqual(['P'])                                              // the page itself is still there
  })
})

describe('references', () => {
  it('links to cards by name: a card that is there can be opened from the page, one that is not is marked', async () => {
    await freshProject(); await open(); await addPage('Cards')
    await text().fill('Play [[Fire Bolt]] or [[Nothing Here]], or ![[Ice]].')
    await app.page.waitForSelector('a.card-ref[data-card-id]')
    expect(await preview().locator('a.card-ref.missing').innerText()).toBe('Nothing Here')
    await app.page.waitForSelector('figure.card-embed img')
    expect(await preview().locator('figure.card-embed img').getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    await preview().locator('a.card-ref[data-card-id]').click()
    await app.page.waitForSelector('.card-grid')
    expect(await app.page.locator('button[role=tab][aria-selected=true]').innerText()).toBe('Card Data')
  })

  it('picks a card or a page from the dialog and writes the reference', async () => {
    await freshProject(); await open(); await addPage('First'); await addPage('Second')
    await text().fill('See ')
    await text().evaluate(t => { t.focus(); t.setSelectionRange(4, 4) })
    await app.page.click('.format button:has-text("Card or page")')
    const dialog = app.page.locator('[role=dialog]'); await dialog.waitFor()
    expect(await axeViolations(app.page)).toEqual([])
    expect(await dialog.locator('section').first().locator('li button').allInnerTexts()).toEqual(['First'])    // not the page being written
    await dialog.locator('input.field').fill('fire')
    await dialog.locator('button[aria-label="Picture of Fire Bolt"]').click()
    expect(await text().inputValue()).toBe('See ![[Fire Bolt]]')
    await app.page.click('.format button:has-text("Card or page")')
    await dialog.waitFor()
    await dialog.locator('button:text-is("First")').click()
    expect(await text().inputValue()).toMatch(/\[First\]\(page:First\)$/)
  })

  it('links to another page, and opening the link opens that page; a title that is not there is marked', async () => {
    await freshProject(); await open(); await addPage('Turns'); await text().fill('The turn.')
    await addPage('Overview'); await text().fill('Read [turns](page:Turns) and [x](page:Nowhere).')
    await app.page.waitForSelector('a.int[data-rules-page="Turns"]')
    expect(await preview().locator('a.int.missing').innerText()).toBe('x')
    await preview().locator('a[data-rules-page="Turns"]').click()
    await app.page.waitForFunction(() => document.getElementById('rules-title').value === 'Turns')
    expect(await text().inputValue()).toBe('The turn.')
  })

  it('shows a picture of the project, and marks one that is not there', async () => {
    await freshProject()
    const png = await makePng(join(app.root, 'board.png'), 40, 30, '#00aa00')
    await app.invoke('assets:import', [png])
    await open(); await addPage('Setup')
    await text().fill('![The board](asset:board.png) ![Gone](asset:nothing.png)')
    await app.page.waitForSelector('img.rules-img[src^="blob:"]')
    expect(await preview().locator('img.rules-img').getAttribute('alt')).toBe('The board')
    await app.page.waitForSelector('.md .missing')
    expect(await preview().locator('.missing').innerText()).toBe('Gone')
  })

  it('inserts a picture from the picker', async () => {
    await freshProject()
    const png = await makePng(join(app.root, 'board.png'), 40, 30, '#00aa00')
    await app.invoke('assets:import', [png])
    await open(); await addPage('Setup')
    await app.page.click('.format button:has-text("Image")')
    await app.page.locator('[role=dialog] [role=option]', { hasText: 'board.png' }).click()
    await expect.poll(() => text().inputValue(), { timeout: 5000 }).toContain('![board](asset:board.png)')
  })

  it('opens a link to the web through the application, and an in-page link scrolls', async () => {
    await freshProject(); await open(); await addPage('Links')
    await text().fill('## Top\n\n[the site](https://example.com/rules)\n\n[to top](#top)')
    await app.page.waitForSelector('a.ext')
    await preview().locator('a.ext').click()
    await app.page.waitForFunction(() => true)
    expect(app.errors).toEqual([])
  })
})

describe('import and export', () => {
  it('saves all the pages as Markdown files and as one web page, and a folder of Markdown files can be added', async () => {
    await freshProject()
    await app.invoke('rules:create', { title: 'Overview', body: 'Hello **world**.' })
    await open()
    // export
    app.mockDialog.open(app.root)
    await app.page.click('button[aria-haspopup=menu]:has-text("Import and export")')
    await app.page.click('[role=menuitem]:has-text("Save all pages as Markdown files")')
    await app.page.waitForSelector('.toast:has-text("Saved to")')
    expect(readFileSync(join(app.root, 'rules', '01-overview.md'), 'utf8')).toBe('# Overview\n\nHello **world**.\n')
    app.mockDialog.save(join(app.root, 'rules.html'))
    await app.page.click('button[aria-haspopup=menu]:has-text("Import and export")')
    await app.page.click('[role=menuitem]:has-text("one web page")')
    await app.page.waitForSelector('.toast:has-text("rules.html")')
    expect(readFileSync(join(app.root, 'rules.html'), 'utf8')).toContain('<strong>world</strong>')
    // import a folder under the selected page
    const dir = join(app.root, 'more'); mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '01-setup.md'), '# Setup\n\nPut out the board.')
    await app.page.locator('[role=treeitem]', { hasText: 'Overview' }).click()
    app.mockDialog.open(dir)
    await app.page.click('button[aria-haspopup=menu]:has-text("Import and export")')
    await app.page.click('[role=menuitem]:has-text("Add a folder under this page")')
    await app.page.waitForSelector('.toast:has-text("Added 1 pages")')
    await expect.poll(() => treeItems().allInnerTexts(), { timeout: 5000 }).toEqual(['Overview', 'Setup'])
    expect(await app.page.locator('[role=treeitem]', { hasText: 'Setup' }).getAttribute('aria-level')).toBe('2')
    expect(await text().inputValue()).toBe('Put out the board.')                       // the first page added is opened
    expect(await app.invoke('rules:list')).toHaveLength(2)
    expect(existsSync(join(app.root, 'rules.html'))).toBe(true)
  })

  it('the file menu is dimmed where it has nothing to do', async () => {
    await freshProject(); await open()
    await app.page.click('button[aria-haspopup=menu]:has-text("Import and export")')
    expect(await app.page.locator('[role=menuitem]:has-text("Save all pages as Markdown")').isDisabled()).toBe(true)
    expect(await app.page.locator('[role=menuitem]:has-text("under this page")').first().isDisabled()).toBe(true)
    expect(await app.page.locator('[role=menuitem]:has-text("Add Markdown files…")').isDisabled()).toBe(false)
    await app.page.keyboard.press('Escape')
  })
})

describe('with the rest of the project', () => {
  it('a new page is a step of undo, and the Edit menu brings it back after it is deleted', async () => {
    await freshProject(); await open(); await addPage('Keep')
    app.page.once('dialog', () => {})
    await app.page.click('button:text-is("Delete")')
    await app.page.waitForFunction(() => document.querySelectorAll('[role=treeitem]').length === 0)
    await app.menu('menu:undo')
    await app.page.waitForSelector('[role=treeitem]')
    await expect.poll(() => treeItems().allInnerTexts(), { timeout: 5000 }).toEqual(['Keep'])
  })
})
