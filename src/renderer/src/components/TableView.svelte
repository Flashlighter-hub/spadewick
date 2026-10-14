<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * The virtual table (PRD §7.9): the project's cards laid out for solo playtesting. Decks, piles, hands, dice and counters; cards are
   * dragged, turned over, shuffled, drawn and dealt, and every move can be undone. Everything that can be done with the pointer can be
   * done with the keyboard and the toolbar.
   *
   * What a table is and how a move changes it is in shared/table.js (plain data, one action per move), so this file only shows the
   * state and turns what the person does into actions.
   */
  import { onMount, onDestroy } from 'svelte'
  import { tableSession, tableState, tableMode, shareInfo, tableName, tableId, savedSteps, startTable, closeTable, act, actAll, undoTable, redoTable, tableChanged, refreshTable, leaveTable } from '../stores/table.js'
  import { createTable, drawAction, dealActions, besides, newSeed, CARD_WIDTH, DIE_SIDES, MAX_SEATS, MAX_DICE, TOKEN_SIZES } from '../../../shared/table.js'
  import { clearPictures, LARGE_WIDTH } from '../lib/tableImages.js'
  import { middlePan } from '../lib/middlePan.js'
  import { toast, openDialog, sidebarVisible } from '../stores/ui.js'
  import { askText, askConfirm } from '../stores/prompt.js'
  import TableCardFace from './TableCardFace.svelte'
  import TableSetupDialog from './TableSetupDialog.svelte'
  import TableOpenDialog from './TableOpenDialog.svelte'
  import TableToken from './TableToken.svelte'
  import TokenColorDialog from './TokenColorDialog.svelte'
  import AssetPicker from './AssetPicker.svelte'
  import TableShareDialog from './TableShareDialog.svelte'
  import PileSearchDialog from './PileSearchDialog.svelte'

  const FELT_W = 3200, FELT_H = 2200       // the table, in table units
  const HAND_W = 104                       // pixels a card is shown at in a hand
  const MOVE = 6                           // pixels the pointer must move before a press becomes a drag

  // what this player sees: the whole table alone, their own hand and the others' counts when it is shared (PRD §22.0)
  $: state = $tableState
  $: guest = $tableMode === 'guest'
  $: shared = $tableMode !== 'solo'
  $: ownSeat = state?.viewer ?? null                      // the hand of this player when the table is shared (null: watching)
  $: lostLink = guest && $shareInfo.status === 'closed'
  $: canUndo = guest ? $shareInfo.status === 'joined' : !!$tableSession?.past.length
  $: canRedo = guest ? $shareInfo.status === 'joined' : !!$tableSession?.future.length
  const handSize = h => (h.hidden ? h.count : h.cards.length)
  let shareOpen = false
  let lastOwn = null
  $: if (shared && ownSeat !== null && ownSeat !== lastOwn) { seat = ownSeat; lastOwn = ownSeat }   // draw into your own hand by default
  $: if (!shared) lastOwn = null
  $: canPlay = !shared || ownSeat !== null                // a player who only watches cannot draw
  $: piles = state ? Object.values(state.piles) : []
  $: tokens = state ? Object.values(state.tokens) : []
  $: changed = !guest && !!$tableSession && $tableSession.log.length !== $savedSteps

  let zoom = 1
  let area, felt, handsW = 1200
  const handEls = []
  const pileEls = {}
  let selected = null                      // { kind: 'pile' | 'token', id } or { kind: 'hand', seat, card }
  let order = {}                           // pile or token id -> how recently it was touched, for what lies on top
  let touched = 0
  let hover = null                         // { id } of a card under the pointer or focus, shown large
  let drag = null                          // { src, x, y, active, over }
  let menu = null                          // { x, y, kind, id, seat? }
  let searching = null                     // pile id
  let setupOpen = false, openOpen = false
  let drawCount = 1
  let seat = 0                             // the hand that draws and deals go to
  let dieSides = 6
  let dieCount = 1                         // dice put on the table at once, rolled together (UPDATES U2)
  let tokenSize = 'medium'                 // size of a new round picture token (UPDATES U4)
  let picked = new Set()                   // tokens chosen together with Shift or Ctrl, to roll as one (UPDATES U2)
  let colorsFor = null                     // token id while the colour dialog is open (UPDATES U3)
  let picking = null                       // { id?, slot: 'asset' | 'asset2' } while the picture of a round token is chosen

  $: if (state && seat >= state.seats) seat = 0
  $: selectedPile = selected?.kind === 'pile' ? state?.piles[selected.id] ?? null : null
  $: if (selected && state) {
    const gone = selected.kind === 'pile' ? !state.piles[selected.id] : selected.kind === 'token' ? !state.tokens[selected.id] : !state.hands[selected.seat]?.cards.includes(selected.card)
    if (gone) selected = null
  }

  const infoOf = id => state.cards[id]
  const deckOf = pile => infoOf(pile.cards[pile.cards.length - 1])
  const raise = id => { order[id] = ++touched; order = order }
  const select = s => { selected = s; if (s && s.kind !== 'hand') raise(s.id) }
  $: if (state) { const gone = [...picked].filter(id => !state.tokens[id]); if (gone.length) picked = new Set([...picked].filter(id => state.tokens[id])) }
  $: turnName = state && state.turn !== null ? handName(state.turn) : ''
  $: handName = i => state?.hands[i]?.name || tr('table.hand', { seat: i + 1 })
  const edges = n => Array.from({ length: Math.min(5, Math.max(0, n - 1)) }, (_, i) => `0 ${(i + 1) * 2}px 0 ${i % 2 ? '#b9b9c4' : '#d6d6de'}`).join(', ') || 'none'

  // ---- starting, saving and opening -------------------------------------------------------------------------------

  const leaveOk = async () => !tableChanged() || await askConfirm(tr('table.confirmLeave'))

  async function newTable() { if (shared) return; if (await leaveOk()) setupOpen = true }
  function begin({ detail }) {
    setupOpen = false
    const table = createTable({ decks: detail.decks, seats: detail.seats, shuffle: detail.shuffle, copies: detail.copies, deal: detail.deal, seed: newSeed() })
    if (!Object.keys(table.cards).length) { toast(tr('table.noCards'), 'info', 4000); return }
    clearPictures()
    startTable(table, { name: '', id: null, steps: 0 })
    selected = null; order = {}; touched = 0
  }

  async function save(asNew = false) {
    if (!state || guest) return
    let name = asNew ? '' : $tableName
    if (!name) {
      name = (await askText(tr('table.saveName'), $tableName || ''))?.trim()
      if (!name) return
    }
    try {
      // what is saved is the whole table (every hand), as the host has it, not what one player sees of it
      const saved = await window.spadewick.table.save({ id: asNew ? undefined : $tableId ?? undefined, name, state: $tableSession.state, log: $tableSession.log })
      tableName.set(saved.name); tableId.set(saved.id); savedSteps.set($tableSession.log.length)
      toast(tr('table.saved', { name: saved.name }), 'info', 2500)
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  async function openSaved({ detail: id }) {
    if (shared || !(await leaveOk())) return
    openOpen = false
    try {
      const loaded = await window.spadewick.table.load(id)
      clearPictures()
      startTable(loaded.state, { name: loaded.name, id: loaded.id, steps: 0 })
      savedSteps.set(0)
      selected = null; order = {}; touched = 0
      if (loaded.missingCards.length) toast(tr('table.missingCards', { n: loaded.missingCards.length }), 'info', 6000)
      await refreshFromProject()   // names, backs and cards that are gone since it was saved
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  function refreshPictures() { clearPictures() }

  /** Look at what the project says now about the cards on the table: names, backs, and cards that are gone (UPDATES U6). */
  async function refreshFromProject(only = null) {
    if (!state || guest) return
    // every card of the table, also those in the hands of other players, which this player's view does not hold
    const onTable = new Set(Object.values($tableSession?.state.cards ?? state.cards).map(c => c.id))
    const ids = (only ?? [...onTable]).filter(id => onTable.has(id))
    if (!ids.length) return
    try { refreshTable(await window.spadewick.table.cardInfo({ ids })) } catch { /* the project is closed: nothing to look at */ }
  }

  // (What the project changes do to the table is done in stores/table.js, which listens all the time: the table is not on screen while a
  // template is being edited, and must be right when it comes back.)

  // ---- zoom ---------------------------------------------------------------------------------------------------------

  const ZOOMS = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2]
  function setZoom(next) {
    if (!area) { zoom = next; return }
    const cx = (area.scrollLeft + area.clientWidth / 2) / zoom, cy = (area.scrollTop + area.clientHeight / 2) / zoom
    zoom = next
    requestAnimationFrame(() => { area.scrollLeft = cx * zoom - area.clientWidth / 2; area.scrollTop = cy * zoom - area.clientHeight / 2 })
  }
  const zoomIn = () => setZoom(ZOOMS.find(z => z > zoom + 1e-6) ?? zoom)
  const zoomOut = () => setZoom([...ZOOMS].reverse().find(z => z < zoom - 1e-6) ?? zoom)
  function onWheel(e) { if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.deltaY < 0 ? zoomIn() : zoomOut() } }

  // ---- what the person does -------------------------------------------------------------------------------------------

  const viewCenter = (w, h) => ({
    x: Math.max(0, (area.scrollLeft + area.clientWidth / 2) / zoom - w / 2 + ((piles.length + tokens.length) % 7) * 22),
    y: Math.max(0, (area.scrollTop + area.clientHeight / 2) / zoom - h / 2 + ((piles.length + tokens.length) % 7) * 22)
  })

  function flip(pile = selectedPile) { if (pile) act({ type: 'flip', pile: pile.id }) }
  function shuffle(pile = selectedPile) { if (pile) act({ type: 'shuffle', pile: pile.id, seed: newSeed() }) }
  function rotate(pile = selectedPile) { if (pile) act({ type: 'rotate', pile: pile.id, rot: pile.rot + 90 }) }
  function draw(pile = selectedPile, toSeat = seat) {
    if (!pile || !canPlay) return
    const a = drawAction(state, pile.id, toSeat, Math.max(1, Math.round(drawCount) || 1))
    if (a) act(a)
  }
  function deal(pile = selectedPile) {
    if (!pile || !canPlay) return
    const acts = dealActions(state, pile.id, Math.max(1, Math.round(drawCount) || 1))
    if (acts.length) actAll(acts)
  }
  function lock(pile = selectedPile) { if (pile) act({ type: 'lock', pile: pile.id, locked: !pile.locked }) }
  async function rename(pile = selectedPile) {
    if (!pile) return
    const name = await askText(tr('table.renamePrompt'), pile.name)
    if (name !== null && name !== undefined) act({ type: 'label', pile: pile.id, name })
  }
  async function collect(pile = selectedPile) {
    if (!pile || guest) return
    if (piles.length + state.hands.reduce((n, h) => n + h.cards.length, 0) > 1 && !await askConfirm(tr('table.confirmCollect', { name: pile.name || tr('table.aPile') }))) return
    act({ type: 'collect', into: pile.id })
  }
  /** A pile can be looked through when every card in it may be seen (not a pile face down in a shared game). */
  const canLook = pile => !!pile && pile.cards.every(id => !state.cards[id]?.hidden)
  function look(pile = selectedPile) { if (canLook(pile)) searching = pile.id }
  function setSeats(count) { if (!guest) act({ type: 'seats', count }) }
  // dice and counters are put side by side along the middle of what is in view, so none lies on another
  const tokenSpot = (w, h) => { const c = viewCenter(w, h); return { x: Math.max(0, c.x - ((piles.length + tokens.length) % 7) * 22 + (tokens.length % 8) * 130), y: Math.max(0, c.y - ((piles.length + tokens.length) % 7) * 22) } }
  function addDie() { const p = tokenSpot(56 + 44 * (dieCount > 1 ? Math.min(dieCount, 4) - 1 : 0), 56); act({ type: 'addToken', kind: 'die', sides: dieSides, count: dieCount, x: p.x, y: p.y }) }
  function addCounter() { const p = tokenSpot(110, 56); act({ type: 'addToken', kind: 'counter', x: p.x, y: p.y }) }
  const rollDie = t => act({ type: 'roll', id: t.id, seed: newSeed() })
  /** Every die that was chosen (or the selected one) rolls: one step of undo, each from a seed of its own. */
  function rollPicked() {
    const ids = picked.size ? [...picked] : selected?.kind === 'token' ? [selected.id] : []
    const dice = ids.map(id => state.tokens[id]).filter(t => t?.kind === 'die')
    if (dice.length) actAll(dice.map(t => ({ type: 'roll', id: t.id, seed: newSeed() })))
  }
  $: canRollPicked = !!state && (picked.size ? [...picked] : selected?.kind === 'token' ? [selected.id] : []).some(id => state.tokens[id]?.kind === 'die')
  const stepToken = (t, n) => act({ type: 'setToken', id: t.id, value: t.value + n })
  const flipToken = t => { if (t.kind === 'token' && t.asset2) act({ type: 'setToken', id: t.id, side: t.side === 1 ? 0 : 1 }) }
  function addPictureToken(assetId) { const p = tokenSpot(TOKEN_SIZES[tokenSize], TOKEN_SIZES[tokenSize]); act({ type: 'addToken', kind: 'token', asset: assetId, size: tokenSize, x: p.x, y: p.y }) }
  function pickedAsset({ detail: assetId }) {
    const was = picking
    picking = null
    if (!was?.id) addPictureToken(assetId)
    else act({ type: 'setToken', id: was.id, [was.slot]: assetId })
  }
  async function askNumber(prompt, current, lo, hi) {
    const text = await askText(prompt, String(current))
    const n = Math.round(Number(text))
    return text !== null && text !== undefined && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null
  }

  // ---- the turn (it restricts nothing: any hand can play at any time) ---------------------------------------------------
  const startTurns = () => act({ type: 'turn', seat: state.turn === null ? 0 : null })
  const nextTurn = () => act({ type: 'nextTurn' })
  const turnRound = () => act({ type: 'turnDirection' })
  async function renameHand(i) {
    const name = await askText(tr('table.handNamePrompt'), state.hands[i].name ?? '')
    if (name !== null && name !== undefined) act({ type: 'nameHand', seat: i, name: name.trim() })
  }

  function playFromHand(seatIdx, card, faceUp = true) {
    const w = infoOf(card).w, h = infoOf(card).h
    const at = viewCenter(w, h)
    act({ type: 'transfer', from: { hand: seatIdx }, cards: [card], to: { x: at.x, y: at.y, faceUp } })
  }

  function takeFromSearch({ detail }) {
    const pile = state.piles[searching]
    if (!pile) return
    if (detail.to.table) {
      const at = besides(pile)
      act({ type: 'transfer', from: { pile: pile.id }, cards: [detail.card], to: { x: at.x, y: at.y, faceUp: true } })
    } else act({ type: 'transfer', from: { pile: pile.id }, cards: [detail.card], to: { hand: detail.to.hand } })
    if (!state.piles[searching]) searching = null
  }

  // ---- dragging ---------------------------------------------------------------------------------------------------

  /** Press on something that can be dragged. `src` says what; a press that does not move far enough is a click. */
  function beginDrag(e, src, onClick) {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY }
    const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    let active = false
    const move = ev => {
      if (!active && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < MOVE) return
      active = true
      drag = { src: { ...src, grab }, x: ev.clientX, y: ev.clientY, over: resolveOver(ev.clientX, ev.clientY, src) }
    }
    const finish = ev => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key)
      const was = drag; drag = null
      if (!active) { onClick?.(ev); return }
      if (was) drop({ ...src, grab }, resolveOver(ev.clientX, ev.clientY, src), ev)
    }
    const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key); drag = null }
    const key = ev => { if (ev.key === 'Escape') cancel() }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key)
  }

  const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

  /** What is under the pointer: a hand (and where in it), another pile, or the bare table. */
  function resolveOver(x, y, src) {
    for (let i = 0; i < handEls.length; i++) {
      const el = handEls[i]; if (!el) continue
      const r = el.getBoundingClientRect()
      if (inside(r, x, y)) {
        const cards = [...el.querySelectorAll('[data-hand-card]')].filter(c => !(src.kind === 'hand' && src.seat === i && src.cards.includes(c.dataset.handCard)))
        let index = cards.length
        for (let k = 0; k < cards.length; k++) { const cr = cards[k].getBoundingClientRect(); if (x < cr.left + cr.width / 2) { index = k; break } }
        return { type: 'hand', seat: i, index }
      }
    }
    if (src.kind !== 'token') {
      const stack = piles.filter(p => !(src.kind === 'pile' && src.whole && p.id === src.pile)).sort((a, b) => (order[b.id] ?? 0) - (order[a.id] ?? 0))
      for (const p of stack) { const el = pileEls[p.id]; if (el && inside(el.getBoundingClientRect(), x, y)) return { type: 'pile', id: p.id } }
    }
    return { type: 'table' }
  }

  function tableAt(clientX, clientY, offset) {
    const r = felt.getBoundingClientRect()
    return { x: Math.round((clientX - r.left) / zoom - offset.x), y: Math.round((clientY - r.top) / zoom - offset.y) }
  }

  /** The pointer lets go: what was dragged goes where it was let go (one action, so one step of undo). */
  function drop(src, over, ev) {
    const upAt = tableAt(ev.clientX, ev.clientY, { x: src.grab.x / zoom, y: src.grab.y / zoom })
    if (src.kind === 'pile') {
      if (over.type === 'hand') act({ type: 'transfer', from: { pile: src.pile }, cards: src.cards, to: { hand: over.seat, index: over.index } })
      else if (over.type === 'pile') { if (over.id !== src.pile) { act({ type: 'transfer', from: { pile: src.pile }, cards: src.cards, to: { pile: over.id } }); raise(over.id) } }
      else if (src.whole) act({ type: 'move', pile: src.pile, x: upAt.x, y: upAt.y })
      else { const id = `p${state.seq + 1}`; act({ type: 'transfer', from: { pile: src.pile }, cards: src.cards, to: { x: upAt.x, y: upAt.y } }); raise(id) }
    } else if (src.kind === 'hand') {
      if (over.type === 'hand') act({ type: 'transfer', from: { hand: src.seat }, cards: src.cards, to: { hand: over.seat, index: over.index } })
      else if (over.type === 'pile') { act({ type: 'transfer', from: { hand: src.seat }, cards: src.cards, to: { pile: over.id } }); raise(over.id) }
      else {
        const at = tableAt(ev.clientX, ev.clientY, { x: src.info.w / 2, y: src.info.h / 2 })
        const id = `p${state.seq + 1}`
        act({ type: 'transfer', from: { hand: src.seat }, cards: src.cards, to: { x: at.x, y: at.y, faceUp: true } })
        raise(id)
      }
    }
  }

  function pileDown(e, pile) {
    if (e.button !== 0) return
    select({ kind: 'pile', id: pile.id })
    if (pile.locked) return
    const whole = pile.cards.length === 1 || e.shiftKey || !!e.target.closest?.('[data-grip]')
    const cards = whole ? [...pile.cards] : [pile.cards[pile.cards.length - 1]]
    beginDrag(e, { kind: 'pile', pile: pile.id, whole, cards, faceUp: pile.faceUp, info: infoOf(cards[cards.length - 1]), rot: pile.rot })
  }

  function handDown(e, seatIdx, card) {
    if (e.button !== 0) return
    select({ kind: 'hand', seat: seatIdx, card })
    beginDrag(e, { kind: 'hand', seat: seatIdx, cards: [card], faceUp: true, info: infoOf(card) })
  }

  function tokenDown(e, t, onClick) {
    if (e.button !== 0) return
    if (e.shiftKey || e.ctrlKey || e.metaKey) {   // choose several tokens, to roll them together
      select({ kind: 'token', id: t.id })
      picked = picked.has(t.id) ? new Set([...picked].filter(id => id !== t.id)) : new Set([...picked, t.id])
      return
    }
    select({ kind: 'token', id: t.id })
    picked = new Set([t.id])
    const el = e.currentTarget
    const start = { x: e.clientX, y: e.clientY }
    const origin = { x: t.x, y: t.y }
    let active = false
    const move = ev => {
      if (!active && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < MOVE) return
      active = true
      el.closest('.token').style.transform = `translate(${(ev.clientX - start.x) / zoom}px, ${(ev.clientY - start.y) / zoom}px)`
    }
    const finish = ev => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish)
      el.closest('.token').style.transform = ''
      if (!active) { onClick?.(); return }
      act({ type: 'moveToken', id: t.id, x: Math.round(origin.x + (ev.clientX - start.x) / zoom), y: Math.round(origin.y + (ev.clientY - start.y) / zoom) })
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish)
  }

  function feltDown(e) { if (e.target === e.currentTarget || e.target.classList.contains('plane')) { selected = null; menu = null; picked = new Set() } }

  // ---- menus ----------------------------------------------------------------------------------------------------------

  function openMenu(e, m) {
    e.preventDefault(); e.stopPropagation()
    if (m.kind === 'pile') select({ kind: 'pile', id: m.id })
    menu = { x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 330), ...m }
  }
  function openMenuAt(el, m) { const r = el.getBoundingClientRect(); menu = { x: Math.min(r.left + 12, window.innerWidth - 230), y: Math.min(r.top + 12, window.innerHeight - 330), ...m } }
  const closeMenu = () => (menu = null)
  const run = fn => () => { const m = menu; menu = null; fn(m) }

  // ---- keyboard -------------------------------------------------------------------------------------------------------

  // ---- the big look (hold Alt) --------------------------------------------------------------------------------------------
  // While Alt is held, the card under the pointer is shown as large as the window allows, in place of the small preview at the corner;
  // Alt and the wheel zoom into it (the zoom follows the pointer, as in Tabletop Simulator), and letting go of Alt puts everything back.
  const BIG_WIDTH = 1100            // pixels the card is drawn at for the big look
  const BIG_MAX = 5
  let altDown = false
  let bigZoom = 1
  let pointer = { x: 0, y: 0 }
  let winW = 1000, winH = 800
  const setAlt = on => { if (altDown === on) return; altDown = on; bigZoom = 1 }
  function onAltKey(e) {
    if (e.key !== 'Alt') return
    if (e.type === 'keydown' && !e.repeat && hover) e.preventDefault()   // Alt alone must not open the window's menu while a card is being looked at
    if (e.type === 'keyup' && altDown) e.preventDefault()
    setAlt(e.type === 'keydown')
  }
  function onBigWheel(e) {
    if (!e.altKey || !hover || !altDown) return
    e.preventDefault()
    bigZoom = Math.min(BIG_MAX, Math.max(1, bigZoom * Math.pow(1.0025, -e.deltaY)))
  }
  const onPointer = e => { pointer = { x: e.clientX, y: e.clientY } }
  $: big = altDown && hover && state?.cards[hover.id] ? state.cards[hover.id] : null
  $: bigW = big ? Math.round(Math.min(winW * 0.92, (winH * 0.92) * big.w / big.h)) : 0

  function onKeydown(e) {
    if (!state || e.target.closest?.('input, select, textarea, [role=dialog], [role=menu]')) return
    if (e.target !== document.body && !e.target.closest?.('.area, .hands')) return
    if (e.key === 'Escape') { if (menu) { menu = null; e.preventDefault() } return }
    if (e.ctrlKey || e.metaKey || e.altKey && !e.target.closest?.('[data-hand-card]')) return
    const handCard = e.target.closest?.('[data-hand-card]')
    if (handCard) {
      const seatIdx = Number(handCard.closest('[data-seat]').dataset.seat), card = handCard.dataset.handCard
      const hand = state.hands[seatIdx].cards, i = hand.indexOf(card)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const j = i + (e.key === 'ArrowRight' ? 1 : -1)
        if (e.altKey) { if (j >= 0 && j < hand.length) { act({ type: 'transfer', from: { hand: seatIdx }, cards: [card], to: { hand: seatIdx, index: j } }); queueMicrotask(() => document.querySelector(`[data-hand-card="${card}"]`)?.focus()) } }
        else document.querySelectorAll(`[data-seat="${seatIdx}"] [data-hand-card]`)[j]?.focus()
      } else if (e.key === 'Enter') { e.preventDefault(); playFromHand(seatIdx, card, !e.shiftKey) }
      else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); openMenuAt(handCard, { kind: 'hand', id: card, seat: seatIdx }) }
      return
    }
    const key = e.key.toLowerCase()
    if (key === 'n' && !e.shiftKey && state.turn !== null) { e.preventDefault(); nextTurn(); return }
    if (selected?.kind === 'pile' && selectedPile) {
      const step = e.shiftKey ? 40 : 10
      if (key === 'f') { e.preventDefault(); flip() }
      else if (key === 's') { e.preventDefault(); shuffle() }
      else if (key === 'r') { e.preventDefault(); rotate() }
      else if (key === 'd') { e.preventDefault(); e.shiftKey ? deal() : draw() }
      else if (key === 'l') { e.preventDefault(); look() }
      else if (e.key === 'Enter') { e.preventDefault(); look() }
      else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); openMenuAt(pileEls[selectedPile.id] ?? e.target, { kind: 'pile', id: selectedPile.id }) }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        act({ type: 'move', pile: selectedPile.id, x: selectedPile.x + dx, y: selectedPile.y + dy })
      }
    } else if (selected?.kind === 'token' && state.tokens[selected.id]) {
      const t = state.tokens[selected.id]
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); act({ type: 'removeToken', id: t.id }) }
      else if (key === 'r' && t.kind === 'die') { e.preventDefault(); rollPicked() }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 40 : 10
        act({ type: 'moveToken', id: t.id, x: t.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), y: t.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) })
      }
    }
  }

  // ---- the application's own undo and redo ---------------------------------------------------------------------------

  const onUndo = e => { if (state) { e.preventDefault(); undoTable() } }
  const onRedo = e => { if (state) { e.preventDefault(); redoTable() } }
  const onRerender = () => clearPictures()
  onMount(() => {
    window.addEventListener('spadewick:undo', onUndo); window.addEventListener('spadewick:redo', onRedo)
    window.addEventListener('spadewick:rerender', onRerender)
    window.addEventListener('click', closeMenu)
  })
  onDestroy(() => {
    window.removeEventListener('spadewick:undo', onUndo); window.removeEventListener('spadewick:redo', onRedo)
    window.removeEventListener('spadewick:rerender', onRerender)
    window.removeEventListener('click', closeMenu)
  })

  // ---- words for what is on the table --------------------------------------------------------------------------------

  const pileLabel = p => tr('table.pileLabel', { name: p.name || tr('table.aPile'), n: p.cards.length, face: p.faceUp ? tr('table.faceUp') : tr('table.faceDown'), top: p.faceUp ? infoOf(p.cards[p.cards.length - 1]).name : '' })
  $: overlap = n => (n <= 1 ? 0 : Math.max(-(HAND_W - 22), Math.min(8, ((handsW / Math.max(1, state?.seats ?? 1)) - 36 - n * HAND_W) / (n - 1))))
</script>

<svelte:window on:keydown={onKeydown} on:keydown={onAltKey} on:keyup={onAltKey} on:blur={() => setAlt(false)} on:wheel|nonpassive={onBigWheel} on:pointermove={onPointer} bind:innerWidth={winW} bind:innerHeight={winH} />

<div class="table-view">
  <div class="bar" role="toolbar" aria-label="{tr('table.toolbar')}">
    <div class="group">
      <button on:click={newTable} disabled={shared}>{tr('table.new')}</button>
      <button on:click={() => (openOpen = true)} disabled={shared}>{tr('table.open')}</button>
      <button on:click={() => save(false)} disabled={!state || guest}>{tr('table.save')}</button>
      <button on:click={() => save(true)} disabled={!state || guest}>{tr('table.saveAs')}</button>
    </div>
    <div class="group" role="group" aria-label="{tr('tableShare.group')}">
      {#if guest}
        <button on:click={leaveTable}>{tr('tableShare.leave')}</button>
      {:else}
        <button on:click={() => (shareOpen = true)} disabled={!state} aria-pressed={$tableMode === 'host'}>{$tableMode === 'host' ? tr('tableShare.sharing', { n: $shareInfo.players.filter(p => !p.away).length }) : tr('tableShare.share')}</button>
        <button on:click={() => openDialog.set('table-join')} disabled={$tableMode === 'host'}>{tr('tableShare.join')}</button>
      {/if}
    </div>
    {#if state}
      <div class="group" role="group" aria-label="{tr('table.history')}">
        <button on:click={undoTable} disabled={!canUndo}>{tr('table.undo')}</button>
        <button on:click={redoTable} disabled={!canRedo}>{tr('table.redo')}</button>
      </div>
      <div class="group" role="group" aria-label="{tr('table.pileActions')}">
        <button on:click={() => flip()} disabled={!selectedPile} title="{tr('table.flipHint')}">{tr('table.flip')}</button>
        <button on:click={() => shuffle()} disabled={!selectedPile} title="{tr('table.shuffleHint')}">{tr('table.shuffle')}</button>
        <button on:click={() => rotate()} disabled={!selectedPile} title="{tr('table.rotateHint')}">{tr('table.rotate')}</button>
        <button on:click={() => look()} disabled={!canLook(selectedPile)} title="{tr('table.lookHint')}">{tr('table.look')}</button>
      </div>
      <div class="group" role="group" aria-label="{tr('table.drawGroup')}">
        <label>{tr('table.count')} <input type="number" min="1" max="60" bind:value={drawCount} class="narrow" /></label>
        <label>{tr('table.toHand')}
          <select bind:value={seat}>{#each state.hands as _, i}<option value={i}>{handName(i)}</option>{/each}</select>
        </label>
        <button on:click={() => draw()} disabled={!selectedPile || !canPlay} title="{tr('table.drawHint')}">{tr('table.draw')}</button>
        <button on:click={() => deal()} disabled={!selectedPile || !canPlay} title="{tr('table.dealHint')}">{tr('table.deal')}</button>
      </div>
      <div class="group" role="group" aria-label="{tr('table.tokens')}">
        <select bind:value={dieCount} aria-label="{tr('table.dieCount')}">{#each Array.from({ length: MAX_DICE }, (_, i) => i + 1) as n}<option value={n}>{n}</option>{/each}</select>
        <select bind:value={dieSides} aria-label="{tr('table.dieSides')}">{#each DIE_SIDES as n}<option value={n}>d{n}</option>{/each}</select>
        <button on:click={addDie}>{tr('table.addDie')}</button>
        <button on:click={rollPicked} disabled={!canRollPicked} title="{tr('table.rollPickedHint')}">{tr('table.rollPicked')}</button>
        <button on:click={addCounter}>{tr('table.addCounter')}</button>
        <select bind:value={tokenSize} aria-label="{tr('table.tokenSize')}">{#each Object.keys(TOKEN_SIZES) as s}<option value={s}>{tr(`table.sizes.${s}`)}</option>{/each}</select>
        <button on:click={() => (picking = { slot: 'asset' })}>{tr('table.addPictureToken')}</button>
      </div>
      <div class="group" role="group" aria-label="{tr('table.turnGroup')}">
        <button on:click={startTurns} aria-pressed={state.turn !== null} title="{tr('table.turnHint')}">{state.turn === null ? tr('table.turnStart') : tr('table.turnStop')}</button>
        <button on:click={nextTurn} disabled={state.turn === null} title="{tr('table.nextTurnHint')}">{tr('table.nextTurn')}</button>
        <button on:click={turnRound} disabled={state.turn === null} aria-label="{tr('table.turnDirectionLabel')}" title="{tr('table.turnDirectionLabel')}">{state.turnDir === -1 ? '↺' : '↻'}</button>
        {#if state.turn !== null}<span class="num" role="status" aria-live="polite">{tr('table.turnOf', { name: turnName })}</span>{/if}
      </div>
      <div class="group" role="group" aria-label="{tr('table.handsGroup')}">
        <button on:click={() => setSeats(state.seats - 1)} disabled={state.seats <= 1 || guest} aria-label="{tr('table.fewerHands')}">−</button>
        <span class="num" aria-live="polite">{tr('table.handsCount', { n: state.seats })}</span>
        <button on:click={() => setSeats(state.seats + 1)} disabled={state.seats >= MAX_SEATS || guest} aria-label="{tr('table.moreHands')}">+</button>
      </div>
      <div class="group" role="group" aria-label="{tr('table.setsGroup')}">
        <button on:click={() => sidebarVisible.update(v => !v)} aria-pressed={!$sidebarVisible} title="{tr('table.setsPanelHint')}">{$sidebarVisible ? tr('table.hideSets') : tr('table.showSets')}</button>
      </div>
      <div class="group" role="group" aria-label="{tr('table.zoom')}">
        <button on:click={zoomOut} disabled={zoom <= ZOOMS[0]} aria-label="{tr('table.zoomOut')}">−</button>
        <span class="num">{Math.round(zoom * 100)}%</span>
        <button on:click={zoomIn} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="{tr('table.zoomIn')}">+</button>
      </div>
      <button on:click={refreshPictures} title="{tr('table.refreshHint')}">{tr('table.refresh')}</button>
      <!-- always there, so that the bar does not change its lines when a table has been changed -->
      <span class="state" role="status">{$tableName || changed ? ($tableName || tr('table.unsaved')) + (changed && $tableName ? ' •' : '') : ''}</span>
    {/if}
  </div>

  {#if lostLink}
    <div class="lost" role="alert">
      <span>{tr('tableShare.lost')}</span>
      <button on:click={() => openDialog.set('table-join')}>{tr('tableShare.reconnect')}</button>
      <button on:click={leaveTable}>{tr('tableShare.leave')}</button>
    </div>
  {/if}

  {#if !state}
    <div class="empty">
      <p>{tr('table.emptyHint')}</p>
      <button class="primary" on:click={newTable}>{tr('table.new')}</button>
    </div>
  {:else}
    <div class="area-wrap">
    <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
    <div class="area" bind:this={area} use:middlePan on:wheel={onWheel} role="region" aria-label="{tr('table.tableRegion')}" tabindex="0">
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="felt" bind:this={felt} style="width:{FELT_W * zoom}px;height:{FELT_H * zoom}px" on:pointerdown={feltDown}>
        <div class="plane" style="width:{FELT_W}px;height:{FELT_H}px;transform:scale({zoom})">
          {#each piles as pile (pile.id)}
            {@const d = deckOf(pile)}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="pile" class:sel={selected?.kind === 'pile' && selected.id === pile.id} class:locked={pile.locked}
              class:over={drag?.over?.type === 'pile' && drag.over.id === pile.id && drag.src.pile !== pile.id}
              role="button" tabindex="0" aria-label={pileLabel(pile)} bind:this={pileEls[pile.id]}
              style="left:{pile.x}px;top:{pile.y}px;width:{d.w}px;height:{d.h}px;transform:rotate({pile.rot}deg);z-index:{order[pile.id] ?? 0}"
              on:pointerdown={e => pileDown(e, pile)} on:dblclick={() => flip(pile)} on:contextmenu={e => openMenu(e, { kind: 'pile', id: pile.id })}
              on:focus={() => { select({ kind: 'pile', id: pile.id }); hover = { id: pile.cards[pile.cards.length - 1], faceUp: pile.faceUp } }}
              on:blur={() => (hover = null)}
              on:pointerenter={() => (hover = { id: pile.cards[pile.cards.length - 1], faceUp: pile.faceUp })} on:pointerleave={() => (hover = null)}>
              <div class="stack" style="box-shadow:{edges(pile.cards.length)}">
                <TableCardFace info={d} faceUp={pile.faceUp} width={d.w} />
              </div>
              {#if pile.cards.length > 1}<span class="count" aria-hidden="true">{pile.cards.length}</span>{/if}
              {#if pile.name}<span class="plabel" aria-hidden="true">{pile.name}</span>{/if}
              {#if pile.locked}<span class="lock" aria-hidden="true">🔒</span>{/if}
              <span class="grip" data-grip aria-hidden="true" title="{tr('table.gripHint')}">⠿</span>
            </div>
          {/each}

          {#each tokens as t (t.id)}
            <div class="token" class:sel={picked.has(t.id) || (selected?.kind === 'token' && selected.id === t.id)} style="left:{t.x}px;top:{t.y}px;z-index:{order[t.id] ?? 0}" role="group"
              aria-label={t.kind === 'die' ? tr('table.dieLabel', { count: t.count, sides: t.sides, total: t.value }) : t.kind === 'counter' ? tr('table.counterLabel', { label: t.label || tr('table.counter'), value: t.value }) : t.label || tr('table.pictureToken')}
              on:contextmenu={e => openMenu(e, { kind: 'token', id: t.id })}>
              <TableToken {t} down={(e, click) => tokenDown(e, t, click)} roll={() => rollDie(t)} step={n => stepToken(t, n)} flip={() => flipToken(t)} />
            </div>
          {/each}
        </div>
      </div>
    </div>
    {#if hover && state.cards[hover.id] && !big}
      <aside class="zoom" aria-hidden="true"><TableCardFace info={state.cards[hover.id]} faceUp={hover.faceUp} width={280} drawn={LARGE_WIDTH} /></aside>
    {/if}
    </div>

    {#if big}
      <div class="big" aria-hidden="true">
        <div class="big-card" style="transform:scale({bigZoom});transform-origin:{(pointer.x / winW) * 100}% {(pointer.y / winH) * 100}%">
          <TableCardFace info={big} faceUp={hover.faceUp} width={bigW} drawn={BIG_WIDTH} />
        </div>
      </div>
    {/if}

    <div class="hands" bind:clientWidth={handsW}>
      {#each state.hands as hand, i (i)}
        <section class="hand" class:target={drag?.over?.type === 'hand' && drag.over.seat === i} class:turn={state.turn === i} data-seat={i} bind:this={handEls[i]} aria-current={state.turn === i ? 'true' : undefined} aria-label="{tr('table.handLabel', { name: handName(i), n: handSize(hand) })}">
          <header>
            <span class="hname">{#if state.turn === i}<b class="mark" aria-hidden="true">▶</b>{/if}{handName(i)}</span>
            <span class="hright"><button class="mini" aria-label="{tr('table.renameHand', { name: handName(i) })}" title="{tr('table.renameHand', { name: handName(i) })}" on:click={() => renameHand(i)}>✎</button><span class="n">{handSize(hand)}</span></span>
          </header>
          <div class="cards">
            {#if hand.hidden}
              <!-- another player's hand: how many cards, never which -->
              <div class="hidden-hand" aria-hidden="true">{#each Array.from({ length: Math.min(handSize(hand), 14) }) as _, k}<span class="mini-back" style="margin-left:{k ? -34 : 0}px" />{/each}</div>
              {#if !handSize(hand)}<span class="none">{tr('table.handEmpty')}</span>{/if}
            {:else}
            {#each hand.cards as id, k (id)}
              <button class="hcard" class:sel={selected?.kind === 'hand' && selected.card === id} data-hand-card={id} style="margin-left:{k ? overlap(hand.cards.length) : 0}px"
                aria-label="{tr('table.handCardLabel', { name: infoOf(id).name, k: k + 1, n: hand.cards.length })}"
                on:pointerdown={e => handDown(e, i, id)} on:dblclick={() => playFromHand(i, id)} on:contextmenu={e => openMenu(e, { kind: 'hand', id, seat: i })}
                on:focus={() => { select({ kind: 'hand', seat: i, card: id }); hover = { id, faceUp: true } }} on:blur={() => (hover = null)}
                on:pointerenter={() => (hover = { id, faceUp: true })} on:pointerleave={() => (hover = null)}>
                <TableCardFace info={infoOf(id)} faceUp={true} width={HAND_W} />
              </button>
            {/each}
            {#if !hand.cards.length}<span class="none">{tr('table.handEmpty')}</span>{/if}
            {/if}
          </div>
        </section>
      {/each}
    </div>
  {/if}

  {#if drag && state}
    {@const g = drag.src}
    <div class="ghost" aria-hidden="true" style="left:{drag.x - g.grab.x}px;top:{drag.y - g.grab.y}px">
      <TableCardFace info={g.info} faceUp={g.faceUp} width={g.kind === 'hand' && drag.over?.type === 'hand' ? HAND_W : Math.round(g.info.w * zoom)} />
      {#if g.whole && g.cards.length > 1}<span class="count">{g.cards.length}</span>{/if}
    </div>
  {/if}
</div>

{#if menu && state}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <ul class="ctx-menu" style="left:{menu.x}px;top:{menu.y}px" role="menu" aria-label="{tr('table.menu')}" on:click|stopPropagation>
    {#if menu.kind === 'pile' && state.piles[menu.id]}
      {@const p = state.piles[menu.id]}
      <li role="none"><button role="menuitem" on:click={run(() => flip(p))}>{tr('table.flip')}</button></li>
      <li role="none"><button role="menuitem" on:click={run(() => shuffle(p))}>{tr('table.shuffle')}</button></li>
      <li role="none"><button role="menuitem" on:click={run(() => rotate(p))}>{tr('table.rotate')}</button></li>
      <li role="none"><button role="menuitem" on:click={run(() => draw(p))}>{tr('table.drawN', { n: drawCount, name: handName(seat) })}</button></li>
      <li role="none"><button role="menuitem" on:click={run(() => deal(p))}>{tr('table.dealN', { n: drawCount })}</button></li>
      <li role="none"><button role="menuitem" disabled={!canLook(p)} on:click={run(() => look(p))}>{tr('table.look')}</button></li>
      <li role="none"><button role="menuitem" on:click={run(() => rename(p))}>{tr('table.rename')}</button></li>
      <li role="none"><button role="menuitem" on:click={run(() => lock(p))}>{p.locked ? tr('table.unlock') : tr('table.lock')}</button></li>
      {#if !guest}<li role="none"><button role="menuitem" on:click={run(() => collect(p))}>{tr('table.collect')}</button></li>{/if}
    {:else if menu.kind === 'hand'}
      <li role="none"><button role="menuitem" on:click={run(m => playFromHand(m.seat, m.id, true))}>{tr('table.playUp')}</button></li>
      <li role="none"><button role="menuitem" on:click={run(m => playFromHand(m.seat, m.id, false))}>{tr('table.playDown')}</button></li>
      {#each state.hands as _, i}
        {#if i !== menu.seat}<li role="none"><button role="menuitem" on:click={run(m => act({ type: 'transfer', from: { hand: m.seat }, cards: [m.id], to: { hand: i } }))}>{tr('table.passTo', { name: handName(i) })}</button></li>{/if}
      {/each}
    {:else if menu.kind === 'token' && state.tokens[menu.id]}
      {@const t = state.tokens[menu.id]}
      {#if t.kind === 'die'}
        <li role="none"><button role="menuitem" on:click={run(() => rollDie(t))}>{tr('table.roll')}</button></li>
        <li role="none"><button role="menuitem" on:click={run(async () => { const n = await askNumber(tr('table.countPrompt', { max: MAX_DICE }), t.count, 1, MAX_DICE); if (n !== null) act({ type: 'setToken', id: t.id, count: n }) })}>{tr('table.diceCount')}</button></li>
        <li role="none"><button role="menuitem" on:click={run(async () => { const n = await askNumber(tr('table.sidesPrompt'), t.sides, 2, 100); if (n !== null) act({ type: 'setToken', id: t.id, sides: n }) })}>{tr('table.diceSides')}</button></li>
        {#if t.count > 1}
          <li role="none"><button role="menuitemradio" aria-checked={t.drop === 'none'} on:click={run(() => act({ type: 'setToken', id: t.id, drop: 'none' }))}>{tr('table.dropNone')}</button></li>
          <li role="none"><button role="menuitemradio" aria-checked={t.drop === 'low'} on:click={run(() => act({ type: 'setToken', id: t.id, drop: 'low' }))}>{tr('table.dropLow')}</button></li>
          <li role="none"><button role="menuitemradio" aria-checked={t.drop === 'high'} on:click={run(() => act({ type: 'setToken', id: t.id, drop: 'high' }))}>{tr('table.dropHigh')}</button></li>
        {/if}
      {:else if t.kind === 'token'}
        <li role="none"><button role="menuitem" on:click={run(() => (picking = { id: t.id, slot: 'asset' }))}>{tr('table.changePicture')}</button></li>
        <li role="none"><button role="menuitem" on:click={run(() => (picking = { id: t.id, slot: 'asset2' }))}>{t.asset2 ? tr('table.changeSecondPicture') : tr('table.addSecondPicture')}</button></li>
        {#if t.asset2}
          <li role="none"><button role="menuitem" on:click={run(() => flipToken(t))}>{tr('table.turnOverToken')}</button></li>
          <li role="none"><button role="menuitem" on:click={run(() => act({ type: 'setToken', id: t.id, asset2: null }))}>{tr('table.removeSecondPicture')}</button></li>
        {/if}
        <li role="none"><button role="menuitem" on:click={run(() => act({ type: 'setToken', id: t.id, showNumber: !t.showNumber }))}>{t.showNumber ? tr('table.hideNumber') : tr('table.showNumber')}</button></li>
        {#each Object.keys(TOKEN_SIZES) as s}
          <li role="none"><button role="menuitemradio" aria-checked={t.size === s} on:click={run(() => act({ type: 'setToken', id: t.id, size: s }))}>{tr(`table.sizeItems.${s}`)}</button></li>
        {/each}
      {/if}
      <li role="none"><button role="menuitem" on:click={run(() => (colorsFor = t.id))}>{tr('table.colors')}</button></li>
      <li role="none"><button role="menuitem" on:click={run(async () => { const name = await askText(tr('table.labelPrompt'), t.label); if (name !== null && name !== undefined) act({ type: 'setToken', id: t.id, label: name }) })}>{tr('table.label')}</button></li>
      <li role="none"><button role="menuitem" on:click={run(() => act({ type: 'removeToken', id: t.id }))}>{tr('table.removeToken')}</button></li>
    {/if}
  </ul>
{/if}

{#if colorsFor && state?.tokens[colorsFor]}
  <TokenColorDialog token={state.tokens[colorsFor]} on:apply={({ detail }) => { act({ type: 'setToken', id: colorsFor, color: detail.color, ink: detail.ink }); colorsFor = null }} on:close={() => (colorsFor = null)} />
{/if}
{#if picking}<AssetPicker current={picking.id ? state?.tokens[picking.id]?.[picking.slot] : null} on:pick={pickedAsset} on:close={() => (picking = null)} />{/if}
{#if shareOpen}<TableShareDialog on:close={() => (shareOpen = false)} />{/if}
{#if setupOpen}<TableSetupDialog on:start={begin} on:close={() => (setupOpen = false)} />{/if}
{#if openOpen}<TableOpenDialog on:open={openSaved} on:close={() => (openOpen = false)} />{/if}
{#if searching && state?.piles[searching]}
  <PileSearchDialog pile={state.piles[searching]} cards={state.cards} seats={state.seats} on:take={takeFromSearch} on:close={() => (searching = null)} />
{/if}

<style>
  .table-view { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--color-bg); }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
  .group { display: flex; align-items: center; gap: 6px; }
  .group label { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--color-text-dim); }
  .narrow { width: 56px; }
  .num { min-width: 44px; text-align: center; font-size: 12px; }
  .state { margin-left: auto; min-width: 90px; min-height: 18px; text-align: right; font-size: 12px; color: var(--color-text-dim); }
  button:disabled { opacity: 0.45; }

  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: var(--color-text-dim); }
  .empty p { max-width: 420px; text-align: center; margin: 0; }

  .area-wrap { flex: 1; min-height: 0; position: relative; display: flex; }
  .area { flex: 1; min-height: 0; position: relative; overflow: auto; background: radial-gradient(ellipse at center, #1f5a45 0%, #14392c 100%); }
  .felt { position: relative; }
  .plane { position: absolute; left: 0; top: 0; transform-origin: 0 0; }

  .pile { position: absolute; cursor: grab; touch-action: none; outline: none; }
  .pile.locked { cursor: default; }
  .pile .stack { border-radius: var(--radius); box-shadow: none; }
  .pile.sel .stack, .pile:focus-visible .stack { outline: 3px solid #ffd43b; outline-offset: 2px; }
  .pile.over .stack { outline: 3px dashed #8ce99a; outline-offset: 3px; }
  .count { position: absolute; right: -8px; bottom: -8px; min-width: 22px; height: 22px; padding: 0 5px; border-radius: var(--radius); background: #212529; color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-sizing: border-box; }
  .plabel { position: absolute; left: 0; right: 0; top: -22px; text-align: center; color: #fff; font-size: 13px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.8); pointer-events: none; }
  .lock { position: absolute; left: 4px; bottom: 4px; font-size: 14px; }
  .grip { position: absolute; left: 50%; top: -2px; transform: translateX(-50%); background: rgba(0,0,0,.6); color: #fff; font-size: 12px; line-height: 1; padding: 2px 8px; border-radius: 0 0 8px 8px; opacity: 0; cursor: move; }
  .pile:hover .grip, .pile:focus-visible .grip { opacity: 1; }

  .token { position: absolute; touch-action: none; }
  .token.sel { outline: 3px solid #ffd43b; outline-offset: 3px; border-radius: 12px; }

  .big { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.6); pointer-events: none; overflow: hidden; }
  .big-card { filter: drop-shadow(0 12px 40px rgba(0,0,0,.7)); will-change: transform; }
  .zoom { position: absolute; right: 24px; top: 14px; width: 280px; pointer-events: none; z-index: 5; filter: drop-shadow(0 8px 20px rgba(0,0,0,.6)); }

  .hands { display: flex; gap: 8px; padding: 8px; background: var(--color-surface); border-top: 1px solid var(--color-border); min-height: 190px; }
  .hand { flex: 1; min-width: 0; border: 1px solid var(--color-control-border); border-radius: var(--radius); padding: 4px 8px 8px; background: var(--color-surface-2); }
  .hand.target { outline: 3px dashed #8ce99a; }
  .hidden-hand { display: flex; align-items: center; padding-left: 4px; min-height: 100px; }
  .mini-back { flex: none; width: 70px; height: 98px; border-radius: var(--radius-sm); border: 2px solid #e8c15a; box-sizing: border-box; background: repeating-linear-gradient(45deg, rgba(255,255,255,.10) 0 5px, transparent 5px 10px), linear-gradient(135deg, #1b1b3a, #3b2fb8); box-shadow: 0 1px 4px rgba(0,0,0,.4); }
  .lost { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: color-mix(in srgb, #e03131 18%, var(--color-surface)); border-bottom: 1px solid var(--color-border); }
  .lost span { flex: 1; }
  .hand.turn { border-color: #ffd43b; box-shadow: 0 0 0 2px #ffd43b; }
  .hname { display: flex; align-items: center; gap: 4px; }
  .hname .mark { color: #ffd43b; }
  .hright { display: flex; align-items: center; gap: 6px; }
  .mini { padding: 0 5px; font-size: 11px; line-height: 1.4; background: none; border: 1px solid transparent; color: var(--color-text-dim); }
  .mini:hover, .mini:focus-visible { border-color: var(--color-control-border); }
  :global(.area[data-panning='true']) { cursor: grabbing; }
  .hand header { display: flex; justify-content: space-between; font-size: 12px; color: var(--color-text-dim); margin-bottom: 4px; }
  .cards { display: flex; align-items: flex-end; min-height: 150px; overflow-x: auto; overflow-y: visible; padding: 8px 4px 0; }
  .hcard { flex: none; padding: 0; border: 0; background: none; border-radius: var(--radius); cursor: grab; touch-action: none; transition: transform .1s; }
  .hcard:hover, .hcard:focus-visible, .hcard.sel { transform: translateY(-14px); position: relative; z-index: 2; }
  .hcard.sel { outline: 3px solid #ffd43b; }
  .none { color: var(--color-text-dim); font-size: 12px; font-style: italic; align-self: center; }

  .ghost { position: fixed; z-index: 9999; pointer-events: none; opacity: .92; filter: drop-shadow(0 8px 14px rgba(0,0,0,.5)); }
  .ctx-menu { position: fixed; z-index: 9000; list-style: none; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); box-shadow: var(--shadow-2); padding: 4px; min-width: 200px; margin: 0; }
  .ctx-menu button { display: block; width: 100%; text-align: left; background: none; border: none; padding: 6px 12px; border-radius: var(--radius-sm); }
  .ctx-menu button:hover { background: var(--color-surface-2); }
</style>
