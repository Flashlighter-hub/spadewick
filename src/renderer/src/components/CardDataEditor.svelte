<script>
  import { askConfirm, askText } from '../stores/prompt.js'
  import { tr } from '../../../shared/i18n.js'
  /**
   * Card data editor — PRD §6
   * A virtualised spreadsheet: only the visible rows are in the DOM, cells are edited in place with
   * keyboard navigation, columns can be resized / reordered / hidden, rows can be dragged to
   * reorder, and editing a cell while several rows are selected applies to all of them.
   */
  import { onMount, onDestroy, tick } from 'svelte'
  import CardPreview from './CardPreview.svelte'
  import DataIoDialog from './DataIoDialog.svelte'
  import AssetPicker from './AssetPicker.svelte'
  import ColorPopup from './ColorPopup.svelte'
  import TagPopup from './TagPopup.svelte'
  import RichText from './RichText.svelte'
  import RichTextEditor from './RichTextEditor.svelte'
  import { cards, fields, activeSetId, activeSet, selectedCardIds, loadSet, templates } from '../stores/project.js'
  import { toast, openDialog, focusCardRequest, cardFilters, instanceEdit } from '../stores/ui.js'
  import { isComputed, optionsOf, lookupOf, STATUSES, ART_STATUSES } from '../../../shared/fieldTypes.js'
  import { PROJECT_CHANGED } from '../stores/projectChanges.js'
  import { visibleRange, moveActive, applySelection, reorderIds, moveItem, clampWidth } from '../lib/grid.js'
  import { validateValue, validateQuantity, MAX_QUANTITY } from '../../../shared/validate.js'
  import { evaluateFormula } from '../../../main/formula.js'
  import { thumbUrl } from '../lib/thumbs.js'

  const ROW_H = 32
  const HANDLE_W = 28
  const DEFAULT_W = 160

  let previewRef
  let previewCollapsed = false
  let dataIoVisible = false
  let dataIoMode = 'import'

  let scroller
  let scrollTop = 0, viewportH = 600
  let active = null            // { row, col }
  let editing = null           // { row, col, value }
  let anchorId = null
  let pickerFor = null         // { cardId, current } while the asset picker is open
  let colorFor = null          // { row, col } while the colour popup is open
  let tagsFor = null           // { row, col } while the tag list of a Tags cell is open
  let menu = null              // { x, y, kind: 'row' | 'column', ... }
  let dropRow = null           // insertion index shown while dragging rows
  let dragCols = null
  let assets = {}              // id -> asset row, for missing-image detection
  let urls = {}
  let widths = {}              // live widths while resizing: field id -> px
  let gripHover = null         // header whose resize grip is under the pointer (disables header dragging)

  $: if ($activeSetId) loadSet($activeSetId)
  $: previewCardId = $selectedCardIds[0] ?? null

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------

  $: visibleFields = $fields.filter(f => !f.hidden)
  $: hiddenFields = $fields.filter(f => f.hidden)
  $: columns = [
    { key: '__id', kind: 'id', label: tr('cardDataEditor.columnId'), width: 110 },
    { key: '__template', kind: 'template', label: tr('cardDataEditor.columnTemplate'), width: 150 },
    { key: '__back', kind: 'back', label: tr('cardDataEditor.columnBack'), width: 150 },
    { key: '__quantity', kind: 'quantity', label: tr('cardDataEditor.columnQuantity'), width: 90 },
    ...(($activeSet?.status_mode ?? 0) >= 1 ? [{ key: '__status', kind: 'status', label: tr('cardDataEditor.columnStatus'), width: 110 }] : []),
    ...(($activeSet?.status_mode ?? 0) >= 2 ? [{ key: '__art', kind: 'art', label: tr('cardDataEditor.columnArt'), width: 110 }] : []),
    ...visibleFields.map(f => ({ key: f.slug, kind: 'field', field: f, label: f.name, width: widths[f.id] ?? f.width_px ?? DEFAULT_W }))
  ]
  // The set's display name and unique identifier are ordinary columns that the set points at (UPDATES U9, U10)
  $: nameSlug = $activeSet?.display_field ?? null
  $: identifierSlug = $activeSet?.identifier_field ?? null
  const cardName = c => c.display_name || c.card_code || tr('cardDataEditor.unnamedCard')
  // identifiers that more than one card has: shown, never blocked (a merge by identifier would update the first)
  $: sharedIdentifiers = (() => {
    if (!identifierSlug) return new Set()
    const seen = new Map()
    for (const c of $cards) { const v = c.fields?.[identifierSlug]; if (v !== undefined && v !== '') seen.set(v, (seen.get(v) ?? 0) + 1) }
    return new Set([...seen].filter(([, n]) => n > 1).map(([v]) => v))
  })()
  $: gridWidth = HANDLE_W + columns.reduce((n, c) => n + c.width, 0)
  $: offsets = columns.reduce((acc, c) => { acc.push((acc.length ? acc[acc.length - 1] + columns[acc.length - 1].width : HANDLE_W)); return acc }, [])

  // ---------------------------------------------------------------------------
  // Filter and saved views (UPDATES U25)
  // ---------------------------------------------------------------------------

  // The filter is an expression in the formula language, worked out by the main process (it knows lookups, formulas and the status).
  // It is kept per set while the person moves between tabs. Cards added while it is on stay visible until it is applied again.
  let matchIds = null          // the ids the filter keeps, or null when there is no filter
  let filterError = ''
  let pinned = new Set()
  let views = []
  let filterSeq = 0, filterTimer
  $: filterState = $cardFilters[$activeSetId] ?? { text: '', viewId: '' }
  $: activeView = views.find(v => v.id === filterState.viewId) ?? null
  $: rows = matchIds ? $cards.filter(c => matchIds.has(c.id) || pinned.has(c.id)) : $cards
  $: loadViews($activeSetId)
  $: applyFilter($activeSetId, filterState.text)

  async function loadViews(setId) {
    views = setId ? await window.spadewick.views.list(setId).catch(() => []) : []
  }
  function setFilter(text, viewId = filterState.viewId) {
    cardFilters.update(m => ({ ...m, [$activeSetId]: { text, viewId } }))
  }
  function applyFilter(setId, text) {
    clearTimeout(filterTimer)
    if (!setId || !String(text).trim()) { filterSeq++; matchIds = null; filterError = ''; pinned = new Set(); return }
    const seq = ++filterSeq
    filterTimer = setTimeout(async () => {
      const res = await window.spadewick.cards.matching({ setId, filter: text }).catch(err => ({ error: err.message }))
      if (seq !== filterSeq) return
      if (res.error) { filterError = res.error; return }   // the rows stay as they were while the expression is not readable
      filterError = ''; matchIds = new Set(res.ids); pinned = new Set()
    }, 200)
  }
  const refilter = () => applyFilter($activeSetId, filterState.text)
  function pickView(id) {
    const v = views.find(x => x.id === id)
    setFilter(v ? v.filter : '', v ? v.id : '')
  }
  async function saveView() {
    const name = await askText(tr('cardDataEditor.viewNamePrompt'))
    if (!name?.trim()) return
    try {
      const v = await window.spadewick.views.create({ setId: $activeSetId, name, filter: filterState.text })
      await loadViews($activeSetId)
      setFilter(v.filter, v.id)
    } catch (err) { toast(err.message, 'error', 5000) }
  }
  async function updateView() {
    try { await window.spadewick.views.update({ id: activeView.id, filter: filterState.text }); await loadViews($activeSetId) } catch (err) { toast(err.message, 'error', 5000) }
  }
  async function renameView() {
    const name = await askText(tr('cardDataEditor.viewNamePrompt'), activeView.name)
    if (!name?.trim() || name.trim() === activeView.name) return
    try { await window.spadewick.views.update({ id: activeView.id, name }); await loadViews($activeSetId) } catch (err) { toast(err.message, 'error', 5000) }
  }
  async function deleteView() {
    if (!await askConfirm(tr('cardDataEditor.confirmDeleteView', { name: activeView.name }))) return
    await window.spadewick.views.delete(activeView.id)
    await loadViews($activeSetId)
    setFilter(filterState.text, '')
  }

  // ---------------------------------------------------------------------------
  // Virtual rows
  // ---------------------------------------------------------------------------

  $: range = visibleRange({ scrollTop, viewportHeight: viewportH, rowHeight: ROW_H, total: rows.length })
  $: shownRows = rows.slice(range.start, range.end).map((card, i) => ({ card, index: range.start + i }))
  $: selectedSet = new Set($selectedCardIds)

  function onScroll() { scrollTop = scroller.scrollTop }

  async function scrollToRow(index) {
    await tick()
    if (!scroller) return
    const top = index * ROW_H
    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (top + ROW_H > scroller.scrollTop + viewportH - 40) scroller.scrollTop = top + ROW_H - viewportH + 40
  }

  function scrollToCol(index) {
    if (!scroller || index == null) return
    const left = offsets[index], right = left + columns[index].width
    if (left - HANDLE_W < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, left - HANDLE_W)
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth
  }

  // "Navigate to card" from the asset browser
  $: if ($focusCardRequest && $focusCardRequest.setId === $activeSetId) goToCard($focusCardRequest.cardId)
  async function goToCard(cardId) {
    for (let i = 0; i < 20 && !$cards.some(c => c.id === cardId); i++) await new Promise(r => setTimeout(r, 25))
    if (matchIds && !matchIds.has(cardId)) { setFilter('', ''); matchIds = null; await tick() }
    const row = rows.findIndex(c => c.id === cardId)
    if (row < 0) return
    selectedCardIds.set([cardId]); anchorId = cardId
    active = { row, col: 0 }
    scrollToRow(row)
    focusCardRequest.set(null)   // handled; do not re-apply when the tab is shown again
  }

  // ---------------------------------------------------------------------------
  // Values
  // ---------------------------------------------------------------------------

  function rawValue(card, col) {
    if (col.kind === 'id') return card.card_code ?? ''
    if (col.kind === 'template') return card.template_id ?? ''
    if (col.kind === 'back') return card.back_template_id ?? ''
    if (col.kind === 'quantity') return card.quantity ?? 1
    if (col.kind === 'status') return card.status ?? ''
    if (col.kind === 'art') return card.art_status ?? ''
    if (col.kind === 'field' && col.field.type === 'lookup') return card.lookups?.[col.key] ?? ''
    return card.fields?.[col.key] ?? ''
  }

  function displayValue(card, col, index) {
    if (col.kind === 'field' && col.field.type === 'formula') {
      const context = { '@card.id': card.card_code ?? '', '@card.number': String(index + 1), '@card.count': String($cards.length) }
      return evaluateFormula(col.field.formula ?? '', { ...(card.fields ?? {}), ...(card.lookups ?? {}), display_name: card.display_name, ...context })
    }
    return String(rawValue(card, col)).replace(/\n/g, ' ⏎ ')
  }

  // The Template and Card back columns: a choice among the set's templates, or "the set's" own
  const slotLabel = (card, col) => (col.kind === 'back'
    ? tr('cardDataEditor.backFor', { name: cardName(card) })
    : tr('cardDataEditor.templateFor', { name: cardName(card) }))
  const slotEmpty = col => (col.kind === 'back' ? tr('cardDataEditor.setBack') : $activeSet?.template_rules ? tr('cardDataEditor.byRuleOrDefault') : tr('cardDataEditor.setDefault'))
  const statusLabel = (kind, card) => (kind === 'art' ? tr('cardDataEditor.artFor', { name: cardName(card) }) : tr('cardDataEditor.statusFor', { name: cardName(card) }))
  const statusWord = (kind, v) => (!v ? '' : kind === 'art' ? tr(`cardDataEditor.art.${v}`) : tr(`cardDataEditor.status.${v}`))
  const statusList = kind => (kind === 'art' ? ART_STATUSES : STATUSES)

  const assetIdOf = v => (typeof v === 'string' && v.startsWith('asset:') ? v.slice(6) : null)

  async function loadAssets() {
    const list = await window.spadewick.assets.list({})
    assets = Object.fromEntries(list.map(a => [a.id, a]))
  }

  // Thumbnails for image cells that are on screen
  $: for (const { card } of shownRows) for (const col of columns) {
    if (col.kind === 'field' && col.field.type === 'image_ref') {
      const id = assetIdOf(card.fields?.[col.key])
      if (id && !(id in urls) && assets[id]) { urls[id] = null; thumbUrl(id).then(u => { urls[id] = u; urls = urls }) }
    }
  }

  // ---------------------------------------------------------------------------
  // Committing edits (bulk-aware)
  // ---------------------------------------------------------------------------

  /** The rows an edit on `row` applies to: every selected row when `row` is part of a multi-selection. */
  function targetsFor(row) {
    const id = rows[row]?.id
    return $selectedCardIds.length > 1 && id && selectedSet.has(id) ? [...$selectedCardIds] : id ? [id] : []
  }

  async function commit(row, colIndex, value) {
    const col = columns[colIndex]
    const ids = targetsFor(row)
    if (!ids.length) return false
    let stored = value

    // An ID belongs to one card: never a bulk edit, and it must stay unique (PRD §5.8)
    if (col.kind === 'id') {
      const card = rows[row]
      const code = String(value).trim()
      if (code === (card.card_code ?? '')) return true
      try {
        const updated = await window.spadewick.cards.update({ id: card.id, cardCode: code })
        cards.update(cs => cs.map(c => (c.id === card.id ? { ...c, card_code: updated.card_code } : c)))
        return true
      } catch (err) { toast(err.message, 'error', 5000); return false }
    }

    if (col.kind === 'field') {
      const check = validateValue(col.field, value)
      if (check.error) { toast(`${col.label}: ${check.error}`, 'error', 4000); return false }
      stored = check.value
    } else if (col.kind === 'quantity') {
      const check = validateQuantity(value)
      if (check.error) { toast(check.error, 'error', 4000); return false }
      stored = check.value
    }
    // a field whose value another field looks up: the looked-up values are asked for again after the change
    const feedsLookup = col.kind === 'field' && $fields.some(f => f.type === 'lookup' && lookupOf(f).from === col.key)

    const unchanged = ids.every(id => String(rawValue($cards.find(c => c.id === id), col)) === String(stored))
    if (unchanged) return true

    // Optimistic update so typing never waits on the database
    cards.update(cs => cs.map(c => {
      if (!ids.includes(c.id)) return c
      if (col.kind === 'template') return { ...c, template_id: stored || null }
      if (col.kind === 'back') return { ...c, back_template_id: stored || null }
      if (col.kind === 'quantity') return { ...c, quantity: stored }
      if (col.kind === 'status') return { ...c, status: stored || null }
      if (col.kind === 'art') return { ...c, art_status: stored || null }
      return { ...c, fields: { ...c.fields, [col.key]: stored }, ...(col.key === nameSlug ? { display_name: String(stored) } : {}) }
    }))
    // a column marked "propagate" also changes the other cards that share the identifier: asked now, so that the person can be told
    const spreads = col.kind === 'field' && identifierSlug && col.field.propagate
      ? (await Promise.all(ids.map(id => window.spadewick.cards.propagatePreview({ id, fields: { [col.key]: stored } })))).flat().filter(r => !ids.includes(r.id))
      : []

    try {
      if (col.kind === 'template') await window.spadewick.cards.batchUpdate({ cardIds: ids, templateId: stored || null })
      else if (col.kind === 'back') await window.spadewick.cards.batchUpdate({ cardIds: ids, backTemplateId: stored || null })
      else if (col.kind === 'quantity') await window.spadewick.cards.batchUpdate({ cardIds: ids, quantity: stored })
      else if (col.kind === 'status') await window.spadewick.cards.batchUpdate({ cardIds: ids, status: stored || '' })
      else if (col.kind === 'art') await window.spadewick.cards.batchUpdate({ cardIds: ids, artStatus: stored || '' })
      else await window.spadewick.cards.batchUpdate({ cardIds: ids, fields: { [col.key]: stored } })
      if (spreads.length || feedsLookup) {
        cards.set(await window.spadewick.cards.list($activeSetId))
        if (spreads.length) toast(tr('cardDataEditor.alsoChanged', { n: new Set(spreads.map(r => r.id)).size }), 'info', 5000)
      }
    } catch (err) {
      toast(tr('cardDataEditor.couldNotSave', { reason: err.message }), 'error', 5000)
      await loadSet($activeSetId)
      return false
    }
    if (previewCardId && ids.includes(previewCardId)) previewRef?.invalidate()
    return true
  }

  // ---------------------------------------------------------------------------
  // Selection and activation
  // ---------------------------------------------------------------------------

  function selectRow(index, event) {
    const ids = rows.map(c => c.id)
    const res = applySelection({ ids, selected: $selectedCardIds, anchor: anchorId }, ids[index], { shift: event?.shiftKey, ctrl: event?.ctrlKey || event?.metaKey })
    selectedCardIds.set(res.selected); anchorId = res.anchor
  }

  function activate(row, col, event) {
    if (editing && (editing.row !== row || editing.col !== col)) finishEdit(true)
    active = { row, col }
    if (event && (event.shiftKey || event.ctrlKey || event.metaKey)) selectRow(row, event)
    else if (!selectedSet.has(rows[row].id) || $selectedCardIds.length <= 1) selectRow(row, null)
    scroller?.focus({ preventScroll: true })
  }

  async function startEdit(row, col, initial) {
    const column = columns[col]
    if (!column || (column.kind === 'field' && isComputed(column.field.type))) return
    if (column.kind === 'template' || column.kind === 'back') return
    if (column.kind === 'status' || column.kind === 'art' || (column.kind === 'field' && column.field.type === 'choice')) { focusSelect(row, column); return }
    if (column.kind === 'field' && column.field.type === 'tags') { openTags(row, col); return }
    // Read-only by default: changing an ID is a deliberate act that asks first
    if (column.kind === 'id' && initial === undefined && !await askConfirm(tr('cardDataEditor.confirmEditId', { name: cardName(rows[row]) }))) return
    const type = column.kind === 'field' ? column.field.type : column.kind === 'quantity' ? 'number' : 'text'
    if (type === 'boolean') { toggleBoolean(row, col); return }
    if (type === 'image_ref') { openPicker(row, col); return }
    if (type === 'color') { colorFor = { row, col }; return }
    const current = rawValue(rows[row], column)
    if (type === 'rich_text') {
      // The rich editor floats over the table, placed from the cell (rows are transformed, so it cannot live inside one)
      const cell = scroller?.querySelector(`[aria-rowindex="${row + 2}"] [data-col="${column.key}"]`)
      const r = cell?.getBoundingClientRect()
      editing = { row, col, value: initial !== undefined ? initial : String(current), type, selectAll: initial === undefined, rect: r ? { left: r.left, top: r.top, bottom: r.bottom } : { left: 100, top: 100, bottom: 130 } }
      return
    }
    editing = { row, col, value: initial !== undefined ? initial : String(current), type }
    tick().then(() => { const el = scroller?.querySelector('.cell-editor'); el?.focus(); if (initial === undefined) el?.select?.() })
  }

  /** Enter on a cell that is a list: the list opens (the cell is a drop-down). */
  async function focusSelect(row, column) {
    await tick()
    const el = scroller?.querySelector(`[aria-rowindex="${row + 2}"] [data-col="${column.key}"] select`)
    el?.focus()
    try { el?.showPicker?.() } catch { /* the list opens with the keyboard instead */ }
  }

  function openTags(row, col) {
    const cell = scroller?.querySelector('[aria-rowindex="' + (row + 2) + '"] [data-col="' + columns[col].key + '"]')
    const r = cell?.getBoundingClientRect()
    tagsFor = { row, col, rect: r ? { left: r.left, top: r.bottom } : { left: 100, top: 100 } }
  }

  async function pickTags(value) {
    if (!tagsFor) return
    const { row, col } = tagsFor
    tagsFor = null
    await commit(row, col, value)
    scroller?.focus({ preventScroll: true })
  }

  async function finishEdit(save, move) {
    if (!editing) return
    const { row, col, value } = editing
    editing = null
    let ok = true
    if (save) ok = await commit(row, col, value)
    if (!ok) { editing = { row, col, value, type: 'text' }; return }
    scroller?.focus({ preventScroll: true })
    if (move) navigate(move.key, move.shift)
  }

  async function toggleBoolean(row, col) {
    const current = rawValue(rows[row], columns[col])
    await commit(row, col, current === 'true' || current === true ? 'false' : 'true')
  }

  function openPicker(row, col) {
    pickerFor = { row, col, current: assetIdOf(rawValue(rows[row], columns[col])) }
  }

  async function pickAsset(id) {
    if (!pickerFor) return
    const { row, col } = pickerFor
    pickerFor = null
    await commit(row, col, id ? `asset:${id}` : '')
    await loadAssets()
    scroller?.focus({ preventScroll: true })
  }

  async function pickColor(value) {
    if (!colorFor) return
    const { row, col } = colorFor
    colorFor = null
    await commit(row, col, value)
    scroller?.focus({ preventScroll: true })
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  async function navigate(key, shift) {
    if (!active) return
    const next = moveActive(active, key, { shift }, { rows: rows.length, cols: columns.length })
    if (next.addRow) {
      next.row = await addCard(); next.col = 0; delete next.addRow
    }
    active = { row: next.row, col: next.col }
    if (key.startsWith('Arrow') || key === 'Enter' || key === 'Tab') selectRow(next.row, null)
    scrollToRow(next.row); scrollToCol(next.col)
  }

  function onKeydown(e) {
    if (editing || pickerFor || colorFor || tagsFor) return
    // Rows picked with the row handle can be deleted without an active cell
    if (e.key === 'Delete' && $selectedCardIds.length && e.target === scroller) { e.preventDefault(); deleteSelected(); return }
    if (!active) { if (rows.length && ['ArrowDown', 'ArrowUp', 'Tab'].includes(e.key) && e.target === scroller) { active = { row: 0, col: 0 }; e.preventDefault() } return }
    const mod = e.ctrlKey || e.metaKey

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && !mod) {
      e.preventDefault()
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {          // extend the row selection
        const target = Math.max(0, Math.min(rows.length - 1, active.row + (e.key === 'ArrowDown' ? 1 : -1)))
        active = { ...active, row: target }; selectRow(target, { shiftKey: true }); scrollToRow(target)
      } else navigate(e.key, false)
    } else if (e.key === 'Tab') {
      // Leave the grid with Tab only when there is nowhere left to go
      const atStart = active.row === 0 && active.col === 0 && e.shiftKey
      if (atStart) return
      e.preventDefault(); navigate('Tab', e.shiftKey)
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      const column = columns[active.col]
      if (column.kind === 'template' || column.kind === 'back') return
      startEdit(active.row, active.col)
    } else if (e.key === ' ' && columns[active.col]?.field?.type === 'boolean') {
      e.preventDefault(); toggleBoolean(active.row, active.col)
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && mod)) {
      e.preventDefault(); deleteSelected()
    } else if (e.key === 'Escape') {
      selectedCardIds.set(active ? [rows[active.row].id] : [])
    } else if (e.key === 'ArrowDown' && mod) {
      e.preventDefault()
    } else if (!mod && !e.altKey && e.key.length === 1) {
      const column = columns[active.col]
      const type = column.kind === 'field' ? column.field.type : column.kind === 'quantity' ? 'number' : 'text'
      if (column.kind !== 'id' && ['text', 'number', 'rich_text'].includes(type)) { e.preventDefault(); startEdit(active.row, active.col, e.key) }
    }
  }

  function onEditorKeydown(e) {
    e.stopPropagation()   // the editor closes synchronously; the grid must not also see this key
    if (e.key === 'Escape') { e.preventDefault(); finishEdit(false) }
    else if (e.key === 'Enter' && !(e.shiftKey && editing.type === 'text' && columns[editing.col].kind === 'field')) {
      e.preventDefault(); finishEdit(true, { key: 'Enter', shift: e.shiftKey })
    } else if (e.key === 'Tab') { e.preventDefault(); finishEdit(true, { key: 'Tab', shift: e.shiftKey }) }
  }

  // ---------------------------------------------------------------------------
  // Rows: add, duplicate, delete, drag-reorder
  // ---------------------------------------------------------------------------

  async function addCard() {
    const defaults = {}
    for (const f of $fields) defaults[f.slug] = f.default_value ?? ''
    const card = await window.spadewick.cards.create({ setId: $activeSetId, displayName: 'New Card', fields: defaults })
    const index = rows.length   // the new card is last in the list, and in what the filter shows
    if (matchIds) pinned = new Set([...pinned, card.id])
    cards.update(cs => [...cs, { ...card, fields: JSON.parse(card.fields_json) }])
    selectedCardIds.set([card.id]); anchorId = card.id
    active = { row: index, col: 0 }
    scrollToRow(index)
    return index
  }

  async function deleteSelected() {
    const ids = [...$selectedCardIds]
    if (!ids.length) return
    if (!await askConfirm(tr('cardDataEditor.confirmDelete', { n: ids.length }))) return
    await window.spadewick.cards.delete(ids)
    const shown = rows.filter(c => !ids.includes(c.id)).length
    const keepRow = Math.min(active?.row ?? 0, Math.max(0, shown - 1))
    cards.update(cs => cs.filter(c => !ids.includes(c.id)))
    selectedCardIds.set([]); active = shown ? { row: keepRow, col: active?.col ?? 0 } : null
  }

  async function duplicateSelected() {
    const ids = [...$selectedCardIds]
    if (!ids.length) return
    const copies = await window.spadewick.cards.duplicate(ids)
    cards.update(cs => [...cs, ...copies.map(c => ({ ...c, fields: JSON.parse(c.fields_json) }))])
    selectedCardIds.set(copies.map(c => c.id))
  }

  let dragIds = null
  function rowDragStart(e, index) {
    // the order of the cards is the order of the whole set, so it is not changed through a filter
    if (matchIds) { e.preventDefault(); toast(tr('cardDataEditor.noReorderWhileFiltered'), 'info', 3000); return }
    const id = rows[index].id
    dragIds = selectedSet.has(id) ? [...$selectedCardIds] : [id]
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', dragIds.join(','))
  }
  function rowDragOver(e, index) {
    if (!dragIds) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    dropRow = e.clientY < rect.top + rect.height / 2 ? index : index + 1
  }
  async function rowDrop(e) {
    e.preventDefault()
    if (!dragIds || dropRow == null) return
    const ids = $cards.map(c => c.id)
    const next = reorderIds(ids, dragIds, dropRow)
    dragIds = null; dropRow = null
    if (next.every((id, i) => id === ids[i])) return
    const byId = new Map($cards.map(c => [c.id, c]))
    cards.set(next.map(id => byId.get(id)))
    await window.spadewick.cards.reorder({ setId: $activeSetId, orderedIds: next })
  }
  const rowDragEnd = () => { dragIds = null; dropRow = null }

  // ---------------------------------------------------------------------------
  // Columns: resize, reorder, hide
  // ---------------------------------------------------------------------------

  function startResize(e, col) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, startW = col.width, id = col.field.id
    const move = ev => { widths = { ...widths, [id]: clampWidth(startW + ev.clientX - startX) } }
    const up = async () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      const w = widths[id]
      if (w && w !== startW) {
        await window.spadewick.fields.setWidth({ id, widthPx: w })
        fields.update(fs => fs.map(f => f.id === id ? { ...f, width_px: w } : f))
      }
      widths = {}
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  function colDragStart(e, i) {
    // A press on the resize grip must never turn into a header drag (even if the pointer-enter update has not landed yet)
    if (gripHover === columns[i].key || e.target.closest?.('.resizer')) { e.preventDefault(); return }
    dragCols = { from: i }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'col')
  }
  async function colDrop(e, i) {
    e.preventDefault()
    if (!dragCols) return
    const fromField = columns[dragCols.from].field, toField = columns[i].field
    dragCols = null
    if (!fromField || !toField || fromField.id === toField.id) return
    const all = $fields.map(f => f.id)
    const next = moveItem(all, all.indexOf(fromField.id), all.indexOf(toField.id))
    fields.update(fs => next.map(id => fs.find(f => f.id === id)))
    await window.spadewick.fields.reorder({ setId: $activeSetId, orderedIds: next })
  }

  async function setHidden(field, hidden) {
    menu = null
    await window.spadewick.fields.update({ id: field.id, hidden })
    fields.update(fs => fs.map(f => f.id === field.id ? { ...f, hidden: hidden ? 1 : 0 } : f))
  }

  function openMenu(e, kind, extra) {
    e.preventDefault()
    menu = { x: e.clientX, y: e.clientY, kind, ...extra }
  }

  const dismissMenu = () => (menu = null)

  function openDataIo(m) { dataIoMode = m; dataIoVisible = true }

  onMount(async () => {
    await loadAssets()
    window.addEventListener('spadewick:history-applied', loadAssets)
    window.addEventListener('spadewick:history-applied', refilter)
    window.addEventListener(PROJECT_CHANGED, onChanged)
  })
  // a view saved or deleted by an undo, and the data an import brought
  function onChanged() { loadViews($activeSetId) }
  onDestroy(() => { window.removeEventListener('spadewick:history-applied', loadAssets); window.removeEventListener('spadewick:history-applied', refilter); window.removeEventListener(PROJECT_CHANGED, onChanged) })
</script>

<svelte:window on:click={dismissMenu} on:keydown={e => { if (e.key === 'Escape') menu = null }} />

<DataIoDialog bind:visible={dataIoVisible} mode={dataIoMode} on:close={() => { dataIoVisible = false; refilter() }} />

{#if pickerFor}
  <AssetPicker current={pickerFor.current} on:pick={e => pickAsset(e.detail)} on:close={() => { pickerFor = null; scroller?.focus() }} />
{/if}

<div class="editor">
  <div class="toolbar" role="toolbar" aria-label="{tr('cardDataEditor.cardTableTools')}">
    <button on:click={addCard} title="{tr('cardDataEditor.addCardTabAtThe')}">{tr('cardDataEditor.card')}</button>
    {#if $selectedCardIds.length > 0}
      <button on:click={duplicateSelected} title="{tr('cardDataEditor.duplicateSelected')}">{tr('cardDataEditor.duplicate')}</button>
      {#if $selectedCardIds.length === 1}<button on:click={() => instanceEdit.set($selectedCardIds[0])} title="{tr('instance.editHint')}">{tr('instance.edit')}</button>{/if}
      <button on:click={deleteSelected} class="danger-btn">{tr('cardDataEditor.delete', { n: $selectedCardIds.length })}</button>
    {/if}
    {#if $selectedCardIds.length > 1}
      <span class="bulk-hint" role="status">{tr('cardDataEditor.editsApplyToAllSelected', { n: $selectedCardIds.length })}</span>
    {/if}
    <span class="spacer" />
    {#if hiddenFields.length}
      <span class="cols-wrap">
        <button title="{tr('cardDataEditor.showHiddenColumns')}" on:click|stopPropagation={e => openMenu(e, 'hidden', {})}>{tr('cardDataEditor.columnsHidden', { n: hiddenFields.length })}</button>
      </span>
    {/if}
    <button title="{tr('cardDataEditor.manageFields')}" on:click={() => openDialog.set('fields')}>{tr('common.fields')}</button>
    <button title="{tr('cardDataEditor.findAndReplace')}" on:click={() => openDialog.set('find-replace')}>{tr('cardDataEditor.findReplace')}</button>
    <button title="{tr('cardDataEditor.importCsvOrJson')}" on:click={() => openDataIo('import')}>{tr('cardDataEditor.import')}</button>
    <button title="{tr('cardDataEditor.exportCsvOrJson')}" on:click={() => openDataIo('export')}>{tr('common.export2')}</button>
    <button class="icon-btn" title="{previewCollapsed ? tr('cardDataEditor.showPreview') : tr('cardDataEditor.hidePreview')}" on:click={() => previewCollapsed = !previewCollapsed} aria-label="{tr('cardDataEditor.togglePreviewPane')}">{previewCollapsed ? '◧' : '◨'}</button>
  </div>

  <div class="filterbar" role="search" aria-label="{tr('cardDataEditor.filterBar')}">
    <select aria-label="{tr('cardDataEditor.savedViews')}" value={filterState.viewId} on:change={e => pickView(e.target.value)}>
      <option value="">{tr('cardDataEditor.allCards')}</option>
      {#each views as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
    </select>
    <input class="filter-input" type="text" spellcheck="false" placeholder="{tr('cardDataEditor.filterPlaceholder')}" aria-label="{tr('cardDataEditor.filterLabel')}" aria-invalid={filterError ? 'true' : undefined}
      value={filterState.text} on:input={e => setFilter(e.target.value)} />
    {#if filterState.text.trim() && !activeView}<button on:click={saveView}>{tr('cardDataEditor.saveView')}</button>{/if}
    {#if activeView && activeView.filter !== filterState.text}<button on:click={updateView}>{tr('cardDataEditor.updateView')}</button>{/if}
    {#if activeView}
      <button on:click={renameView}>{tr('cardDataEditor.renameView')}</button>
      <button on:click={deleteView}>{tr('cardDataEditor.deleteView')}</button>
    {/if}
    {#if filterState.text.trim()}
      <button class="icon-btn" title="{tr('cardDataEditor.filterAgain')}" aria-label="{tr('cardDataEditor.filterAgain')}" on:click={refilter}>↻</button>
      <button class="icon-btn" title="{tr('cardDataEditor.clearFilter')}" aria-label="{tr('cardDataEditor.clearFilter')}" on:click={() => setFilter('', '')}>✕</button>
    {/if}
    {#if matchIds}<span class="count" role="status">{tr('cardDataEditor.shownOf', { shown: rows.length, total: $cards.length })}</span>{/if}
    {#if filterError}<span class="filter-error" role="alert">{filterError}</span>{/if}
  </div>

  <div class="body">
    <div
      class="card-grid"
      role="grid"
      aria-label="{tr('common.cards')}"
      aria-rowcount={rows.length + 2}
      aria-colcount={columns.length + 1}
      aria-multiselectable="true"
      tabindex="0"
      bind:this={scroller}
      bind:clientHeight={viewportH}
      on:scroll={onScroll}
      on:keydown={onKeydown}
    >
      <div class="grid-inner" style="width:{gridWidth}px">
        <div class="grid-head" role="row" aria-rowindex="1">
          <div class="head-cell handle" style="width:{HANDLE_W}px" role="columnheader"><span class="sr-only">{tr('cardDataEditor.rowSelectionAndOrder')}</span></div>
          {#each columns as col, i (col.key)}
            <!-- the grid is one tab stop and moves between cells with the arrow keys (PRD 14.4) -->
            <!-- svelte-ignore a11y-interactive-supports-focus -->
            <div
              class="head-cell"
              class:draggable={col.kind === 'field'}
              style="width:{col.width}px"
              role="columnheader"
              aria-colindex={i + 2}
              title={col.kind === 'field' ? tr('cardDataEditor.columnHint') : col.kind === 'quantity' ? tr('cardDataEditor.quantityHint') : col.kind === 'id' ? tr('cardDataEditor.idHint') : ''}
              draggable={col.kind === 'field' && gripHover !== col.key}
              on:dragstart={e => col.kind === 'field' && colDragStart(e, i)}
              on:dragover={e => dragCols && col.kind === 'field' && e.preventDefault()}
              on:drop={e => col.kind === 'field' && colDrop(e, i)}
              on:contextmenu={e => col.kind === 'field' && openMenu(e, 'column', { field: col.field })}
            >
              <span class="head-label">{col.label}</span>
              {#if col.kind === 'field' && col.key === nameSlug}<span class="chip" title="{tr('cardDataEditor.nameChipHint')}">{tr('cardDataEditor.nameChip')}</span>{/if}
              {#if col.kind === 'field' && col.key === identifierSlug}<span class="chip" title="{tr('cardDataEditor.identifierChipHint')}">{tr('cardDataEditor.identifierChip')}</span>{/if}
              {#if col.kind === 'field'}
                <!-- column resizing is a pointer-only enhancement; width is also persisted per set -->
                <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
                <span class="resizer" role="separator" aria-orientation="vertical" aria-label="{tr('cardDataEditor.resize', { label: col.label })}"
                  on:mouseenter={() => gripHover = col.key} on:mouseleave={() => gripHover = null} on:mousedown={e => startResize(e, col)} />
              {/if}
            </div>
          {/each}
        </div>

        <div class="grid-body" style="height:{rows.length * ROW_H}px" role="rowgroup">
          {#each shownRows as { card, index } (card.id)}
            <!-- the grid is one tab stop and moves between cells with the arrow keys (PRD 14.4) -->
            <!-- svelte-ignore a11y-interactive-supports-focus -->
            <div
              class="grid-row"
              class:selected={selectedSet.has(card.id)}
              class:drop-before={dropRow === index}
              class:drop-after={dropRow === index + 1 && index === rows.length - 1}
              style="transform:translateY({index * ROW_H}px);height:{ROW_H}px"
              role="row"
              aria-rowindex={index + 2}
              aria-selected={selectedSet.has(card.id)}
              data-card-id={card.id}
              on:dragover={e => rowDragOver(e, index)}
              on:drop={rowDrop}
              on:contextmenu={e => { if (!selectedSet.has(card.id)) selectRow(index, null); openMenu(e, 'row', { index }) }}
            >
              <!-- drag handle; keyboard users select rows with Shift+Up/Down on the grid (PRD 14.4) -->
              <!-- svelte-ignore a11y-interactive-supports-focus a11y-click-events-have-key-events -->
              <div
                class="row-handle"
                style="width:{HANDLE_W}px"
                role="rowheader"
                title="{tr('cardDataEditor.dragToReorderClickTo')}"
                draggable="true"
                on:dragstart={e => rowDragStart(e, index)}
                on:dragend={rowDragEnd}
                on:click={e => selectRow(index, e)}
              >⠿</div>

              {#each columns as col, ci (col.key)}
                {@const isActive = active && active.row === index && active.col === ci}
                {@const isEditing = editing && editing.row === index && editing.col === ci}
                {@const type = col.kind === 'field' ? col.field.type : col.kind}
                <!-- the grid is one tab stop and moves between cells with the arrow keys (PRD 14.4) -->
                <!-- svelte-ignore a11y-interactive-supports-focus -->
                <div
                  class="cell type-{type}"
                  class:active={isActive}
                  class:editing={isEditing}
                  style="width:{col.width}px"
                  role="gridcell"
                  aria-colindex={ci + 2}
                  aria-selected={isActive}
                  data-col={col.key}
                  title={type === 'formula' ? tr('cardDataEditor.formulaTitle', { formula: col.field.formula ?? '' }) : type === 'lookup' ? tr('cardDataEditor.lookupTitle') : ''}
                  on:mousedown={e => { if (!isEditing && e.button === 0) activate(index, ci, e) }}
                  on:dblclick={() => startEdit(index, ci)}
                >
                  {#if isEditing}
                    {#if editing.type === 'rich_text'}
                      <span class="text"><RichText text={editing.value} inline slug={col.key} /></span>
                    {:else if editing.type === 'text' && col.kind === 'field'}
                      <textarea class="cell-editor" rows={Math.min(6, editing.value.split('\n').length)} bind:value={editing.value}
                        on:keydown={onEditorKeydown} on:blur={() => finishEdit(true)} aria-label={col.label} />
                    {:else}
                      {#if type === 'number' || type === 'quantity'}
                        <input class="cell-editor" type="number" step={type === 'quantity' ? 1 : 'any'} min={type === 'quantity' ? 0 : undefined} max={type === 'quantity' ? MAX_QUANTITY : undefined} value={editing.value} on:input={e => editing.value = e.target.value}
                          on:keydown={onEditorKeydown} on:blur={() => finishEdit(true)} aria-label={col.label} />
                      {:else}
                        <input class="cell-editor" type="text" value={editing.value} on:input={e => editing.value = e.target.value}
                          on:keydown={onEditorKeydown} on:blur={() => finishEdit(true)} aria-label={col.label} />
                      {/if}
                    {/if}
                  {:else if col.kind === 'template' || col.kind === 'back'}
                    <select value={rawValue(card, col)} aria-label={slotLabel(card, col)}
                      on:change={e => commit(index, ci, e.target.value)} on:focus={() => activate(index, ci)}>
                      <option value="">{slotEmpty(col)}</option>
                      {#each $templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
                    </select>
                  {:else if col.kind === 'status' || col.kind === 'art'}
                    <select value={rawValue(card, col)} aria-label={statusLabel(col.kind, card)}
                      on:change={e => commit(index, ci, e.target.value)} on:focus={() => activate(index, ci)}>
                      <option value="">{tr('cardDataEditor.noStatus')}</option>
                      {#each statusList(col.kind) as v (v)}<option value={v}>{statusWord(col.kind, v)}</option>{/each}
                    </select>
                  {:else if type === 'choice'}
                    {@const current = String(rawValue(card, col))}
                    {@const list = optionsOf(col.field)}
                    <select value={current} aria-label="{col.label}: {current || tr('common.none')}"
                      on:change={e => commit(index, ci, e.target.value)} on:focus={() => activate(index, ci)}>
                      <option value=""></option>
                      {#each list as o (o)}<option value={o}>{o}</option>{/each}
                      {#if current && !list.includes(current)}<option value={current}>{current} ⚠</option>{/if}
                    </select>
                  {:else if type === 'tags'}
                    {@const tags = String(rawValue(card, col))}
                    <button class="tags-btn" aria-label="{col.label}: {tags || tr('common.none')}" on:click|stopPropagation={() => { activate(index, ci); openTags(index, ci) }}>
                      {#if tags}<span class="tags-text">{tags}</span>{:else}<span class="none">{tr('cardDataEditor.choose')}</span>{/if}
                    </button>
                  {:else if type === 'boolean'}
                    <input type="checkbox" checked={rawValue(card, col) === 'true' || rawValue(card, col) === true}
                      aria-label={col.label} on:click|stopPropagation={() => { activate(index, ci); toggleBoolean(index, ci) }} />
                  {:else if type === 'color'}
                    <button class="swatch-btn" aria-label="{col.label}: {rawValue(card, col) || tr('common.none')}" on:click|stopPropagation={() => { activate(index, ci); colorFor = { row: index, col: ci } }}>
                      <span class="swatch" style="background:{rawValue(card, col) || 'transparent'}" />
                      <span class="hex">{rawValue(card, col)}</span>
                    </button>
                    {#if colorFor && colorFor.row === index && colorFor.col === ci}
                      <ColorPopup value={rawValue(card, col) || '#000000'} on:pick={e => pickColor(e.detail)} on:close={() => { colorFor = null; scroller?.focus() }} />
                    {/if}
                  {:else if type === 'image_ref'}
                    {@const aid = assetIdOf(rawValue(card, col))}
                    <button class="image-btn" aria-label="{col.label}: {aid ? (assets[aid]?.original_name ?? tr('cardDataEditor.missingImageName')) : tr('common.none')}" on:click|stopPropagation={() => { activate(index, ci); openPicker(index, ci) }}>
                      {#if aid && !assets[aid]}
                        <span class="missing" title="{tr('cardDataEditor.thisImageWasDeleted')}">{tr('cardDataEditor.missingImage')}</span>
                      {:else if aid}
                        {#if urls[aid]}<img src={urls[aid]} alt="" />{:else}<span class="ph">▨</span>{/if}
                        <span class="fname">{assets[aid]?.original_name}</span>
                      {:else}
                        <span class="none">{tr('cardDataEditor.choose')}</span>
                      {/if}
                    </button>
                  {:else if type === 'rich_text'}
                    <span class="text"><RichText text={rawValue(card, col)} inline slug={col.key} /></span>
                  {:else}
                    <span class="text" class:formula={type === 'formula' || type === 'lookup'} class:code={col.kind === 'id'} class:shared={col.key === identifierSlug && sharedIdentifiers.has(card.fields?.[identifierSlug])}
                      title={col.key === identifierSlug && sharedIdentifiers.has(card.fields?.[identifierSlug]) ? tr('cardDataEditor.sharedIdentifier') : undefined}>{displayValue(card, col, index)}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>

        <div class="add-row" role="row" aria-rowindex={rows.length + 2} style="top:{30 + rows.length * ROW_H}px"><div role="gridcell"><button class="add-row-btn" on:click={addCard}>{tr('cardDataEditor.addCard')}</button></div></div>
      </div>
    </div>

    {#if !previewCollapsed}
      <CardPreview bind:this={previewRef} cardId={previewCardId} />
    {/if}
  </div>
</div>

{#if editing?.type === 'rich_text'}
  <RichTextEditor value={editing.value} label={columns[editing.col]?.label ?? ''} rect={editing.rect} selectAll={editing.selectAll}
    on:commit={e => { if (editing) { editing.value = e.detail; finishEdit(true) } }} on:cancel={() => finishEdit(false)} />
{/if}

{#if tagsFor}
  <TagPopup rect={tagsFor.rect} value={String(rawValue(rows[tagsFor.row], columns[tagsFor.col]))} options={optionsOf(columns[tagsFor.col].field)}
    on:pick={e => pickTags(e.detail)} on:close={() => { tagsFor = null; scroller?.focus() }} />
{/if}

{#if menu}
  <!-- click only stops propagation so the window click handler does not close the menu; Escape closes it -->
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <ul class="ctx-menu" style="left:{menu.x}px;top:{menu.y}px" role="menu" on:click|stopPropagation>
    {#if menu.kind === 'row'}
      {#if $selectedCardIds.length === 1}<li role="menuitem"><button on:click={() => { menu = null; instanceEdit.set($selectedCardIds[0]) }}>{tr('instance.edit')}</button></li>{/if}
      <li role="menuitem"><button on:click={() => { menu = null; duplicateSelected() }}>{tr('cardDataEditor.duplicateCards', { n: $selectedCardIds.length })}</button></li>
      <li role="menuitem"><button on:click={() => { menu = null; deleteSelected() }}>{tr('cardDataEditor.deleteCards', { n: $selectedCardIds.length })}</button></li>
    {:else if menu.kind === 'column'}
      <li role="menuitem"><button on:click={() => setHidden(menu.field, true)}>{tr('cardDataEditor.hideColumn', { name: menu.field.name })}</button></li>
    {:else}
      {#each hiddenFields as f (f.id)}
        <li role="menuitem"><button on:click={() => setHidden(f, false)}>{tr('cardDataEditor.show', { name: f.name })}</button></li>
      {/each}
    {/if}
  </ul>
{/if}

<style>
  .editor { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--color-surface); border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
  .spacer { flex: 1; }
  .filterbar { display: flex; align-items: center; gap: 6px; padding: 4px 10px; background: var(--color-surface); border-bottom: 1px solid var(--color-border); flex-shrink: 0; flex-wrap: wrap; }
  .filter-input { flex: 1 1 260px; min-width: 160px; font-family: var(--font-mono); font-size: 12px; }
  .filter-input[aria-invalid='true'] { border-color: var(--color-danger); }
  .filter-error { color: var(--color-danger-text); font-size: 11px; }
  .count { color: var(--color-text-dim); font-size: 11px; }
  .tags-btn { display: flex; align-items: center; background: none; border: none; padding: 0; width: 100%; text-align: left; color: inherit; overflow: hidden; }
  .tags-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bulk-hint { font-size: 11px; color: var(--color-accent-text); }
  .danger-btn { background: transparent; color: var(--color-danger-text); border-color: var(--color-danger); }
  .danger-btn:hover { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
  .icon-btn { background: none; border: none; padding: 3px 6px; font-size: 14px; color: var(--color-text-dim); }
  .icon-btn:hover { color: var(--color-text); background: var(--color-surface-2); }

  .body { flex: 1; display: flex; overflow: hidden; min-height: 0; }
  .card-grid { flex: 1; overflow: auto; position: relative; min-width: 0; outline: none; font-size: 12px; }
  .card-grid:focus-visible { box-shadow: inset 0 0 0 2px var(--color-accent); }
  .grid-inner { position: relative; min-height: 100%; }

  .grid-head { position: sticky; top: 0; z-index: 3; display: flex; height: 30px; background: var(--color-surface-2); border-bottom: 1px solid var(--color-control-border); }
  .head-cell { position: relative; display: flex; align-items: center; padding: 0 8px; font-weight: 600; white-space: nowrap; overflow: hidden; border-right: 1px solid var(--color-border); flex-shrink: 0; }
  .head-cell.handle { padding: 0; }
  .head-cell.draggable { cursor: grab; }
  .head-label { overflow: hidden; text-overflow: ellipsis; }
  .resizer { position: absolute; right: 0; top: 0; bottom: 0; width: 6px; cursor: col-resize; }
  .resizer:hover { background: var(--color-accent); }

  .grid-body { position: relative; }
  .grid-row { position: absolute; left: 0; right: 0; display: flex; border-bottom: 1px solid var(--color-border); }
  .grid-row { transition: background-color .1s ease; }
  .grid-row:hover { background: color-mix(in srgb, var(--color-accent) 7%, var(--color-surface)); }
  /* selection is shown by a bar on the left edge as well as the tint, so it never depends on colour alone */
  .grid-row.selected { background: color-mix(in srgb, var(--color-accent) 18%, transparent); box-shadow: inset 4px 0 0 var(--color-accent-text); }
  .grid-row.drop-before { box-shadow: 0 -2px 0 var(--color-accent); }
  .grid-row.drop-after { box-shadow: 0 2px 0 var(--color-accent); }
  .row-handle { flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--color-text-dim); cursor: grab; user-select: none; }

  .cell { position: relative; flex-shrink: 0; display: flex; align-items: center; padding: 0 8px; overflow: hidden; border-right: 1px solid var(--color-border); }
  .cell.active { outline: 2px solid var(--color-accent); outline-offset: -2px; background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
  .cell.editing { overflow: visible; z-index: 5; padding: 0; }
  .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .text.formula { color: var(--color-text-dim); font-style: italic; }
  .chip { margin-left: 6px; padding: 0 5px; border-radius: var(--radius); background: var(--color-surface); color: var(--color-text-dim); font-size: 10px; font-weight: 400; }
  .text.shared { text-decoration: underline wavy var(--color-warning); text-underline-offset: 3px; }
  .text.code { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-dim); }
  .cell.active .text.code, .grid-row.selected .text.code { color: var(--color-text); }   /* the dim text keeps its contrast on the highlighted cell */
  .cell select { width: 100%; border-color: transparent; background-color: transparent; }
  .cell select:hover, .cell select:focus { border-color: var(--color-accent-text); background-color: var(--color-surface); }

  .cell-editor { width: 100%; min-height: 100%; border: 2px solid var(--color-accent); border-radius: 0; background: var(--color-surface); box-sizing: border-box; font: inherit; resize: none; padding: 2px 6px; }
  textarea.cell-editor { position: absolute; left: 0; top: 0; min-height: 31px; max-height: 160px; z-index: 6; }

  .swatch-btn, .image-btn { display: flex; align-items: center; gap: 6px; background: none; border: none; padding: 0; width: 100%; text-align: left; color: inherit; overflow: hidden; }
  .swatch { width: 18px; height: 18px; border: 1px solid var(--color-border); border-radius: 3px; flex-shrink: 0; }
  .hex { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-dim); }
  .image-btn img { width: 24px; height: 24px; object-fit: contain; flex-shrink: 0; }
  .fname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .none { color: var(--color-text-dim); font-style: italic; }
  .missing { color: var(--color-danger-text); }

  .add-row { position: absolute; left: 0; }
  .add-row-btn { margin-left: 8px; background: none; border: none; color: var(--color-text-dim); padding: 6px; }
  .add-row-btn:hover { color: var(--color-text); background: none; }

  .ctx-menu { position: fixed; z-index: 90; list-style: none; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); box-shadow: var(--shadow-2); padding: 4px; min-width: 180px; }
  .ctx-menu button { display: block; width: 100%; text-align: left; background: none; border: none; padding: 6px 12px; border-radius: var(--radius-sm); }
  .ctx-menu button:hover { background: var(--color-surface-2); }
</style>
