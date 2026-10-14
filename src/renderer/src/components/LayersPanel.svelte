<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * Layers panel — PRD §8.7.2
   * Lists the selectable elements of the template (those with a `data-spadewick-id`), front-most first,
   * and asks the canvas editor to reorder them. The panel never edits the SVG itself: it reports what the
   * user wants (`move`, `select`, `hide`, `lock`) and re-reads the source when it changes.
   */
  import { createEventDispatcher, afterUpdate } from 'svelte'
  import { layerLabel } from '../lib/layers.js'

  export let svgSource = ''
  export let selectedId = null
  export let selectedIds = []        // everything that is selected (A80); selectedId is the one the panel shows
  export let hiddenIds = new Set()
  export let lockedIds = new Set()

  const dispatch = createEventDispatcher()

  let collapsed = new Set()
  let announce = ''
  let listEl
  let dragId = null
  let dropAt = null          // { id, side: 'front' | 'behind' }
  let pendingMove = null     // { id, before } while a move waits for the new source to arrive
  let scrolledTo = null
  let renaming = null        // { id, value } while an id is being edited
  let renameError = ''

  $: rows = buildRows(svgSource, collapsed)

  $: allIds = [...svgSource.matchAll(/data-(?:spadewick|cardexy)-id="([^"]+)"/g)].map(m => m[1])

  const fieldOf = el => el.getAttribute('data-spadewick-field') || (/\{\{\s*(\w+)\s*\}\}/.exec(el.getAttribute('href') || el.getAttribute('fill') || '') || [])[1] || ''

  /** Front-most first; rows that share a `key` are siblings in the SVG and can be reordered among themselves. */
  function buildRows(src, collapsedIds) {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml')
    if (doc.querySelector('parsererror')) return []
    const out = []
    const hasChildren = el => !!el.querySelector('[data-spadewick-id]')
    const walk = (node, depth, key) => {
      const kids = [...node.children]
      for (let i = kids.length - 1; i >= 0; i--) {
        const el = kids[i]
        const id = el.getAttribute('data-spadewick-id')
        const childKey = `${key}/${i}`
        if (id) {
          const tag = el.localName
          out.push({ id, tag, depth, key, hasKids: hasChildren(el), label: layerLabel({ text: tag === 'text' ? el.textContent : '', field: fieldOf(el), id }) })
          if (!collapsedIds.has(id)) walk(el, depth + 1, childKey)
        } else walk(el, depth, childKey)   // an element without an id is background: look through it
      }
    }
    walk(doc.documentElement, 0, '')
    return out
  }

  const TYPES = new Map([['text', 'typeText'], ['image', 'typeImage'], ['rect', 'typeRect'], ['ellipse', 'typeEllipse'], ['circle', 'typeCircle'], ['g', 'typeGroup'], ['path', 'typePath'], ['line', 'typeLine'], ['polygon', 'typePolygon'], ['polyline', 'typePolygon']])
  const typeName = tag => tr(`layersPanel.${TYPES.get(tag) ?? 'typeOther'}`)
  const ICONS = new Map([['text', 'T'], ['image', '🖼'], ['rect', '▭'], ['ellipse', '◯'], ['circle', '◯'], ['g', '▤'], ['path', '✎'], ['line', '╱'], ['polygon', '⬠'], ['polyline', '⬠']])

  function siblingsOf(row) { return rows.filter(r => r.key === row.key) }
  function rowName(row) {
    const sibs = siblingsOf(row)
    const state = [hiddenIds.has(row.id) && tr('layersPanel.hiddenState'), lockedIds.has(row.id) && tr('layersPanel.lockedState')].filter(Boolean).join(', ')
    const base = tr('layersPanel.rowName', { label: row.label, type: typeName(row.tag), pos: sibs.indexOf(row) + 1, total: sibs.length })
    return state ? `${base}, ${state}` : base
  }

  function requestMove(detail) {
    pendingMove = { id: detail.id, before: svgSource }
    dispatch('move', detail)
    setTimeout(() => { pendingMove = null }, 1000)   // a move that changed nothing never delivers a new source
  }

  const focusRow = id => listEl?.querySelector(`[data-layer="${CSS.escape(id)}"]`)?.focus()

  function onRowKey(e, row) {
    if (e.altKey && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      // The list shows the front first, so Up moves an element towards the front
      const op = e.key === 'ArrowUp' ? 'forward' : e.key === 'ArrowDown' ? 'backward' : e.key === 'Home' ? 'front' : 'back'
      requestMove({ id: row.id, op })
    } else if (e.key === 'F2') {
      e.preventDefault()
      startRename(row)
    } else if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const i = rows.indexOf(row) + (e.key === 'ArrowUp' ? -1 : 1)
      if (rows[i]) focusRow(rows[i].id)
    }
  }

  function onDragStart(e, row) {
    dragId = row.id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', row.id)
  }
  function onDragOver(e, row) {
    const dragged = rows.find(r => r.id === dragId)
    if (!dragged || dragged.key !== row.key || row.id === dragId) { dropAt = null; return }
    e.preventDefault()
    const box = e.currentTarget.getBoundingClientRect()
    dropAt = { id: row.id, side: e.clientY < box.top + box.height / 2 ? 'front' : 'behind' }
  }
  function onDrop(e) {
    e.preventDefault()
    if (dragId && dropAt) requestMove({ id: dragId, target: dropAt.id, side: dropAt.side })
    endDrag()
  }
  const endDrag = () => { dragId = null; dropAt = null }

  // Renaming changes the element's `data-spadewick-id` only; the label in the list follows its text or field
  function startRename(row) {
    renameError = ''
    renaming = { id: row.id, value: row.id }
  }
  function commitRename() {
    if (!renaming) return
    const { id, value } = renaming
    const to = value.trim()
    if (to === id) { renaming = null; return }
    if (!/^[A-Za-z_][\w.-]*$/.test(to)) { renameError = tr('layersPanel.renameInvalid'); return }
    if (allIds.includes(to)) { renameError = tr('layersPanel.renameTaken', { id: to }); return }
    renaming = null
    renameError = ''
    pendingMove = { id: to, before: svgSource }
    dispatch('rename', { id, to })
  }
  function onRenameKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitRename() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const id = renaming?.id; renaming = null; renameError = ''; setTimeout(() => focusRow(id), 0) }
  }
  const focusInput = node => { node.focus(); node.select() }
  function cancelRename() { renaming = null; renameError = '' }

  function toggleCollapsed(id) {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id); else next.add(id)
    collapsed = next
  }

  afterUpdate(() => {
    if (pendingMove && svgSource !== pendingMove.before) {
      const row = rows.find(r => r.id === pendingMove.id)
      if (row) {
        const sibs = siblingsOf(row)
        announce = tr('layersPanel.moved', { label: row.label, pos: sibs.indexOf(row) + 1, total: sibs.length })
        focusRow(row.id)
      }
      pendingMove = null
    }
    if (selectedId && selectedId !== scrolledTo) {
      scrolledTo = selectedId
      listEl?.querySelector(`[data-layer="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
    } else if (!selectedId) scrolledTo = null
  })
</script>

<section class="layers" aria-label="{tr('layersPanel.title')}">
  <h2 class="title">{tr('layersPanel.title')}</h2>
  {#if rows.length}
    <p class="hint">{tr('layersPanel.keyboardHint')}</p>
    <ul class="rows" bind:this={listEl} aria-label="{tr('layersPanel.listLabel')}">
      {#each rows as row (row.id)}
        <li style="padding-left:{row.depth * 14}px">
          <!-- Dragging is a pointer shortcut: every move can also be made with Alt+arrows on the row's button -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="row"
            class:selected={selectedIds.includes(row.id) || selectedId === row.id}
            class:dragging={dragId === row.id}
            class:drop-front={dropAt?.id === row.id && dropAt.side === 'front'}
            class:drop-behind={dropAt?.id === row.id && dropAt.side === 'behind'}
            draggable="true"
            on:dragstart={e => onDragStart(e, row)}
            on:dragover={e => onDragOver(e, row)}
            on:drop={onDrop}
            on:dragend={endDrag}
          >
            {#if row.hasKids}
              <button class="twisty" aria-expanded={!collapsed.has(row.id)} aria-label="{collapsed.has(row.id) ? tr('layersPanel.expand', { label: row.label }) : tr('layersPanel.collapse', { label: row.label })}" on:click={() => toggleCollapsed(row.id)}>{collapsed.has(row.id) ? '▸' : '▾'}</button>
            {/if}
            {#if renaming?.id === row.id}
              <input class="rename" use:focusInput bind:value={renaming.value} aria-label="{tr('layersPanel.renameLabel', { label: row.label })}" on:keydown={onRenameKey} on:blur={cancelRename} />
            {:else}
              <button
                class="main"
                data-layer={row.id}
                aria-current={selectedId === row.id ? 'true' : undefined}
                aria-label={rowName(row)}
                on:click={e => dispatch('select', { id: row.id, additive: e.ctrlKey || e.metaKey || e.shiftKey })}
                on:dblclick={() => startRename(row)}
                on:keydown={e => onRowKey(e, row)}
              >
                <span class="icon" aria-hidden="true">{ICONS.get(row.tag) ?? '·'}</span>
                <span class="label">{row.label}</span>
                {#if hiddenIds.has(row.id)}<span class="badge" aria-hidden="true">{tr('layersPanel.hiddenState')}</span>{/if}
                {#if lockedIds.has(row.id)}<span class="badge" aria-hidden="true">{tr('layersPanel.lockedState')}</span>{/if}
              </button>
            {/if}
            <button class="mini" aria-label="{hiddenIds.has(row.id) ? tr('layersPanel.showLayer', { label: row.label }) : tr('layersPanel.hideLayer', { label: row.label })}" on:click={() => dispatch('hide', { id: row.id })}>{hiddenIds.has(row.id) ? tr('layersPanel.show') : tr('layersPanel.hide')}</button>
            <button class="mini" aria-label="{lockedIds.has(row.id) ? tr('layersPanel.unlockLayer', { label: row.label }) : tr('layersPanel.lockLayer', { label: row.label })}" on:click={() => dispatch('lock', { id: row.id })}>{lockedIds.has(row.id) ? tr('layersPanel.unlock') : tr('layersPanel.lock')}</button>
          </div>
        </li>
      {/each}
    </ul>
    {#if renameError}<p class="rename-error" role="alert">{renameError}</p>{/if}
    <p class="hint">{tr('layersPanel.backgroundNote')}</p>
  {:else}
    <p class="hint">{tr('layersPanel.empty')}</p>
  {/if}
  <div class="sr-only" role="status" aria-live="polite">{announce}</div>
</section>

<style>
  .layers { flex: 1; min-height: 0; overflow: auto; background: var(--color-surface); display: flex; flex-direction: column; gap: 6px; padding: 8px 6px; font-size: 11px; }
  .title { font-size: 12px; padding: 0 4px; }
  .hint { color: var(--color-text-dim); font-style: italic; padding: 0 4px; }
  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .row { display: flex; align-items: center; gap: 2px; border-radius: 4px; border: 1px solid transparent; position: relative; }
  .row.selected { background: color-mix(in srgb, var(--color-accent) 20%, transparent); box-shadow: inset 4px 0 0 var(--color-accent-text); }
  .row.dragging { opacity: 0.5; }
  .row.drop-front::before, .row.drop-behind::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: var(--color-accent-text); }
  .row.drop-front::before { top: -2px; }
  .row.drop-behind::after { bottom: -2px; }
  .main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; text-align: left; background: none; border: none; color: inherit; padding: 4px 4px; cursor: pointer; }
  .main:hover { background: var(--color-surface-2); }
  .main:focus-visible, .mini:focus-visible, .twisty:focus-visible { outline: 2px solid var(--color-accent-text); outline-offset: -2px; }
  .row.selected .main { font-weight: 700; }
  .icon { width: 14px; text-align: center; flex: none; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { flex: none; font-size: 10px; border: 1px solid var(--color-border); border-radius: 3px; padding: 0 3px; color: var(--color-text-dim); }
  .rename { flex: 1; min-width: 0; font-size: 11px; }
  .rename-error { color: var(--color-danger-text, var(--color-text)); padding: 0 4px; }
  .mini { flex: none; font-size: 10px; padding: 1px 4px; }
  .twisty { flex: none; width: 16px; background: none; border: none; color: inherit; padding: 0; }
</style>
