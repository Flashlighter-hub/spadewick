<script>
  /**
   * The editor for a Rich text cell (PRD §16.7): a small multi-line box with a toolbar (Bold, Italic, Underline, Colour,
   * Insert icon) and a live preview. The text it edits is the markup itself, so it can always be edited as plain text.
   *
   * Keys: Ctrl+B bold, Ctrl+I italic, Ctrl+U underline, Ctrl+Enter done, Escape cancel. Leaving the editor saves.
   */
  import { createEventDispatcher, onMount, tick } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import { parseMarkup } from '../../../shared/richText.js'
  import { starterIcon, starterIconNames, iconPathData } from '../../../shared/starterIcons.js'
  import { iconLibrary, keywordRules, iconsByKey } from '../stores/textLibrary.js'
  import { toggleWrap, insertText, BOLD, ITALIC, UNDERLINE, colorWrap } from '../lib/richEdit.js'
  import RichText from './RichText.svelte'
  import ColorPopup from './ColorPopup.svelte'

  export let value = ''
  export let label = ''
  export let rect = { left: 0, top: 0, bottom: 0 }   // the cell the editor belongs to, in window coordinates
  export let selectAll = true                         // false when editing starts with a typed character

  const dispatch = createEventDispatcher()
  let root, area
  let colorOpen = false, iconsOpen = false, keywordsOpen = false, iconQuery = ''

  const WIDTH = 420, HEIGHT = 340
  $: left = Math.max(8, Math.min(rect.left, (typeof window === 'undefined' ? 1200 : window.innerWidth) - WIDTH - 8))
  $: top = typeof window !== 'undefined' && rect.bottom + 4 + HEIGHT > window.innerHeight ? Math.max(8, rect.top - HEIGHT - 4) : rect.bottom + 4

  onMount(() => {
    area.focus()
    if (selectAll) area.select(); else area.setSelectionRange(value.length, value.length)
  })

  $: parsed = parseMarkup(value)
  $: missingIcons = [...new Set(parsed.runs.filter(r => r.icon && !starterIcon(r.icon) && !$iconsByKey.has(r.icon)).map(r => r.icon))]
  // The project's icons first (they override a built-in one of the same name), then the built-in set
  $: allIcons = [...$iconLibrary.icons.map(i => ({ name: i.name, library: i })), ...starterIconNames().filter(n => !$iconLibrary.icons.some(i => i.name === n)).map(name => ({ name }))]
  $: icons = allIcons.filter(i => i.name.includes(iconQuery.trim().toLowerCase().replace(/[\s_]+/g, '-')) || i.library?.aliases.some(a => a.includes(iconQuery.trim().toLowerCase())))
  // Keywords that can be typed: the plain words of the rules, not patterns
  $: keywords = [...new Set($keywordRules.filter(r => !r.isPattern && r.enabled).map(r => r.match))]

  const problemText = p =>
    p.type === 'unmatched' ? tr('richText.problemUnmatched', { text: p.text })
    : p.type === 'unknownStyle' ? tr('richText.problemStyle', { name: p.text })
    : p.type === 'badIconParam' ? tr('richText.problemIconParam', { text: p.text })
    : tr('richText.problemInvalid', { text: p.text })

  /** Apply an edit result to the text box and keep the selection where it says. */
  async function apply(r) {
    value = r.value
    await tick()
    area.focus()
    area.setSelectionRange(r.start, r.end)
  }
  const wrap = (open, close) => apply(toggleWrap(value, area.selectionStart, area.selectionEnd, open, close))
  const insert = text => apply(insertText(value, area.selectionStart, area.selectionEnd, text))

  // Closing a popup removes the element that has the focus, which the browser reports as focus leaving: that must not save
  // the text. `closing` covers the moment between closing a popup and putting the focus back in the text box.
  let closing = false
  async function closePopups() {
    closing = true
    colorOpen = false; iconsOpen = false; keywordsOpen = false; iconQuery = ''
    await tick()
    area?.focus()
    closing = false
  }

  async function pickColor(hex) {
    await closePopups()
    if (hex) { const c = colorWrap(hex); wrap(c.open, c.close) }
  }
  async function pickIcon(name) {
    await closePopups()
    insert(`{icon:${name}}`)
  }
  async function pickKeyword(word) {
    await closePopups()
    insert(word)
  }
  async function toggle(which) {
    const open = which === 'color' ? !colorOpen : which === 'icons' ? !iconsOpen : !keywordsOpen
    await closePopups()
    if (open) { colorOpen = which === 'color'; iconsOpen = which === 'icons'; keywordsOpen = which === 'keywords' }
  }

  const commit = () => dispatch('commit', value)
  const cancel = () => dispatch('cancel')

  function onKeydown(e) {
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Escape') {
      e.preventDefault()
      if (colorOpen || iconsOpen || keywordsOpen) closePopups(); else cancel()
    } else if (mod && e.key === 'Enter') { e.preventDefault(); commit() }
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap(BOLD) }
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap(ITALIC) }
    else if (mod && !e.shiftKey && e.key.toLowerCase() === 'u') { e.preventDefault(); wrap(UNDERLINE) }
  }

  // Saving when focus leaves the editor altogether, not when it moves between the box, the toolbar and the popups
  function onFocusOut(e) { if (!closing && !root.contains(e.relatedTarget)) commit() }
</script>

<!-- keydown here only routes the editor's own keys and keeps them from the table behind it -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="rte" role="dialog" aria-label={tr('richText.editorLabel', { name: label })} tabindex="-1" bind:this={root}
  style="left:{left}px;top:{top}px;width:{WIDTH}px" on:keydown|stopPropagation={onKeydown} on:focusout={onFocusOut}>
  <div class="toolbar" role="toolbar" aria-label={tr('richText.toolbar')}>
    <button type="button" class="b" aria-label={tr('richText.bold')} title={tr('richText.boldTitle')} on:mousedown|preventDefault on:click={() => wrap(BOLD)}>B</button>
    <button type="button" class="i" aria-label={tr('richText.italic')} title={tr('richText.italicTitle')} on:mousedown|preventDefault on:click={() => wrap(ITALIC)}>I</button>
    <button type="button" class="u" aria-label={tr('richText.underline')} title={tr('richText.underlineTitle')} on:mousedown|preventDefault on:click={() => wrap(UNDERLINE)}>U</button>
    <span class="rel">
      <button type="button" aria-label={tr('richText.color')} title={tr('richText.color')} aria-haspopup="dialog" aria-expanded={colorOpen} on:mousedown|preventDefault on:click={() => toggle('color')}>A<span class="swatch" /></button>
      {#if colorOpen}<ColorPopup value="#cc3333" on:pick={e => pickColor(e.detail)} on:close={closePopups} />{/if}
    </span>
    <span class="rel">
      <button type="button" aria-label={tr('richText.insertIcon')} title={tr('richText.insertIcon')} aria-haspopup="dialog" aria-expanded={iconsOpen} on:mousedown|preventDefault on:click={() => toggle('icons')}>★</button>
      {#if iconsOpen}
        <div class="icons" role="dialog" aria-label={tr('richText.insertIcon')}>
          <!-- svelte-ignore a11y-autofocus -->
          <input type="search" placeholder={tr('richText.searchIcons')} aria-label={tr('richText.searchIcons')} bind:value={iconQuery} autofocus />
          <div class="grid">
            {#each icons as i (i.name)}
              <button type="button" class="pick" title={i.name} aria-label={i.name} on:click={() => pickIcon(i.name)}>
                {#if i.library}<RichText text={`{icon:${i.name}}`} inline />{:else}<svg viewBox="0 0 100 100" aria-hidden="true"><path d={iconPathData(starterIcon(i.name))} fill="currentColor" /></svg>{/if}
              </button>
            {:else}<span class="dim">{tr('richText.noIconMatches')}</span>{/each}
          </div>
        </div>
      {/if}
    </span>
    <span class="rel">
      <button type="button" aria-label={tr('richText.insertKeyword')} title={tr('richText.insertKeyword')} aria-haspopup="dialog" aria-expanded={keywordsOpen} on:mousedown|preventDefault on:click={() => toggle('keywords')}>K</button>
      {#if keywordsOpen}
        <div class="icons" role="dialog" aria-label={tr('richText.insertKeyword')}>
          <!-- svelte-ignore a11y-autofocus -->
          <ul class="words" aria-label={tr('richText.insertKeyword')}>
            {#each keywords as word}<li><button type="button" on:click={() => pickKeyword(word)} autofocus={word === keywords[0]}>{word}</button></li>{:else}<li class="dim">{tr('richText.noKeywords')}</li>{/each}
          </ul>
        </div>
      {/if}
    </span>
    <span class="hint">{tr('richText.hint')}</span>
  </div>

  <textarea bind:this={area} bind:value rows="5" spellcheck="true" aria-label={tr('richText.markupLabel')} />

  <div class="preview" role="region" aria-label={tr('richText.preview')}><RichText text={value} /></div>
  {#if parsed.problems.length || missingIcons.length}
    <ul class="problems" aria-label={tr('richText.problems')}>
      {#each parsed.problems as p}<li>{problemText(p)}</li>{/each}
      {#each missingIcons as name}<li>{tr('richText.problemIcon', { name })}</li>{/each}
    </ul>
  {/if}

  <div class="foot">
    <button type="button" on:click={cancel}>{tr('common.cancel')}</button>
    <button type="button" class="primary" on:click={commit}>{tr('common.done')}</button>
  </div>
</div>

<style>
  .rte { position: fixed; z-index: 60; background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius); box-shadow: 0 8px 28px rgba(0,0,0,.45); padding: 8px; display: flex; flex-direction: column; gap: 6px; outline: none; }
  .toolbar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .toolbar > button, .rel > button { min-width: 28px; height: 26px; }
  .b { font-weight: 700; } .i { font-style: italic; } .u { text-decoration: underline; }
  .rel { position: relative; display: inline-flex; }
  .swatch { display: inline-block; width: 8px; height: 3px; background: #cc3333; margin-left: 2px; vertical-align: middle; }
  .hint { font-size: 11px; color: var(--color-text-dim); margin-left: auto; }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; font-family: var(--font-mono); font-size: 12px; }
  .preview { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 6px 8px; min-height: 40px; max-height: 110px; overflow: auto; background: var(--color-bg); }
  .problems { margin: 0; padding-left: 18px; font-size: 11px; color: var(--color-danger-text); }
  .foot { display: flex; justify-content: flex-end; gap: 6px; }
  .icons { position: absolute; z-index: 62; top: 100%; left: 0; width: 230px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 6px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, 36px); gap: 4px; }
  .pick { width: 36px; height: 36px; padding: 6px; }
  .pick svg { width: 100%; height: 100%; }
  .dim { color: var(--color-text-dim); font-size: 12px; }
  .words { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 200px; overflow: auto; }
  .words button { width: 100%; text-align: left; }
</style>
