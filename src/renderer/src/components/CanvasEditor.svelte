<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * Canvas editor — PRD §8
   * A Konva overlay on the rendered card. Only elements carrying `data-spadewick-id` are interactive.
   * The SVG source string is the single source of truth: every canvas edit rewrites it.
   */
  import Konva from 'konva'
  import AssetPicker from './AssetPicker.svelte'
  import AppearanceSection from './AppearanceSection.svelte'
  import LayersPanel from './LayersPanel.svelte'
  import { buildTargets, snapRect, gapsFor, SNAP_PX } from '../lib/snap.js'
  import { reorder, moveRelative, sameOrder } from '../lib/layers.js'
  import { fitImage } from '../lib/liveFit.js'
  import { TOOL_ICONS as ICONS, ALIGN_ICONS } from '../lib/icons.js'
  import { createEventDispatcher, onMount, onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { cards, fields, activeSetId, loadSet } from '../stores/project.js'
  import ResizeHandle from './ResizeHandle.svelte'
  import { layout, setLayout, LIMITS } from '../stores/layout.js'
  import { canvasCommand, toast } from '../stores/ui.js'
  import { askText } from '../stores/prompt.js'
  import { styleAttrs, styleFromAttrs } from '../lib/textStyleApply.js'
  import { boundsOf, alignOffsets, distributeOffsets } from '../lib/align.js'
  import { holdClip, heldClip } from '../lib/clipboard.js'
  import * as comps from '../lib/docComponent.js'
  import ComponentLibraryDialog from './ComponentLibraryDialog.svelte'
  import { readGradient, writeGradient, readEffects, writeEffects, getStyleProp, setStyleProp, documentColours } from '../lib/docPaint.js'
  import { topLevel, groupElements, ungroupElement, cloneElements, serializeElements, pasteElements, removeElements, layerize, descendants } from '../lib/docEdit.js'

  export let svgSource = ''
  export let templateId = null
  export let focus = null         // { id, cardId, n } from Show me: select this element, on this card
  export let bleedMm = 0          // the bleed the template's canvas includes (PRD §17.4); 0 when it is trim size
  export let bleedMode = 'extend'

  const dispatch = createEventDispatcher()
  const NS = 'http://www.w3.org/2000/svg'
  const GRID = 10
  const BOX_TAGS = ['rect', 'image', 'foreignObject', 'use', 'svg']

  let scroller, stageHost, measureHost
  let stage, bgLayer, liveLayer, gridLayer, printLayer, uiLayer, transformer, bgNode
  let tool = 'select' // select | text | image | rect | ellipse
  let showGrid = false
  let showPrintGuides = false   // trim, safe and bleed lines (PRD §17.4): editor only, never in the file or an export
  let safeMm = 3                // the safe margin the export uses (production settings), for the guides
  async function loadSafe() { try { const o = await window.spadewick.settings.get('production_options'); if (o && Number(o.safeMm) >= 0) safeMm = Number(o.safeMm) } catch { /* the default is fine */ } }
  let snap = false
  let showRulers = true
  let smartGuides = true   // snapping to edges and other elements, with guide lines (PRD §8.7.4)
  let hiddenIds = new Set()   // editor-only view state of the layers panel (PRD §8.7.2): never written to the SVG
  let lockedIds = new Set()
  let lockAspect = false
  let docSize = { w: 500, h: 700 }
  // The pasteboard: a margin around the card where elements that spill over its edge can be seen, taken hold of, moved and resized. The card
  // itself (the template's size) never changes; what lies outside it is simply not part of the card (the picture and every export cut it off).
  const PASTEBOARD = 0.35   // of the card's longer side, on every side
  let pad = 0               // in card units; set together with docSize (so the code that runs straight after a change sees the new one)
  let stageBed, frameEl, stageView
  let parseError = ''
  let renderError = ''
  let selectedId = null       // the element the properties panel shows: the last one selected
  let selectedIds = []        // everything that is selected (A80)
  let editing = null          // { id, value, original } while the words of a text are typed on the canvas (A80)
  let pendingEdit = null      // a new text that starts being edited as soon as it is measured
  let groupNode = null        // one rectangle that stands for a selection of several: the transformer is attached to it
  let groupDrag = null, marquee = null, collapseOnClick = null, pasteCount = 0
  $: multi = selectedIds.length > 1
  export let cardId = null        // the card the editor draws the template with (the editor chooses one itself when none is given)
  export let lockCard = false     // the card is not to be chosen in the editor (a card's own version of the template is edited for that card)
  let fontFamilies = []
  let boxes = {}     // id -> { x, y, w, h, tag } measured in SVG units
  let props = null   // properties of the selected element
  let setSize = null // the active set's card size, to warn when the template has a different shape
  let renderTimer, measureTimer, lastSource = null, destroyed = false

  // ---- zoom and pan (A79) ----
  // The stage is scaled; every shape stays in card units, so nothing that edits the SVG needs to know the zoom.
  const ZOOM_MIN = 0.1, ZOOM_MAX = 8, FRAME_PAD = 24, RULER = 22
  const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
  let zoom = 1
  let zoomReady = false          // the first view (100%, or smaller when the card does not fit) has been chosen
  let viewW = 0, viewH = 0       // size of the scrolling area
  let scrollX = 0, scrollY = 0, originX = 0, originY = 0   // for the rulers: where the card's corner is, inside the scrolling area
  let shiftHeld = false
  let spaceDown = false, panning = null, pointerOver = false   // pointerOver: the pointer is on the canvas, so Space pans whatever else has the focus
  let lastRenderPx = 0
  const dpr = () => (typeof window !== 'undefined' && window.devicePixelRatio) || 1

  let sideH = 0
  $: topH = Math.round(Math.min(sideH * LIMITS.propsSplit.max, Math.max(sideH * LIMITS.propsSplit.min, sideH * $layout.propsSplit)))

  $: bleedIn = bleedMode === 'included' && bleedMm > 0 ? bleedMm : 0   // a canvas that includes bleed is larger than the card
  $: aspectMismatch = setSize && docSize.h > 0 && Math.abs(docSize.w / docSize.h - (setSize.mmW + 2 * bleedIn) / (setSize.mmH + 2 * bleedIn)) > 0.02
  $: hasCards = $cards.length > 0
  $: if (!cardId && $cards.length) cardId = $cards[0].id
  $: if (svgSource !== lastSource) sourceChanged()
  $: if (gridLayer) drawGrid(showGrid, docSize, zoom)
  $: if (bgLayer) drawVeil(docSize, pad, zoom)
  $: if (focus && focus.n !== appliedFocus && stage && boxes[focus.id]) applyFocus(focus)
  $: if (printLayer) drawPrintGuides(showPrintGuides, docSize, setSize, bleedMm, bleedMode, safeMm, zoom)
  $: if (stage && !zoomReady && viewW > 0 && viewH > 0 && docSize.w > 0) chooseFirstView()
  $: viewW, viewH, docSize, syncView()
  // until the person has zoomed or moved the view, the card stays in the middle of it while the panels around the canvas settle and change its width
  let userView = false
  $: if (zoomReady && !userView && viewW > 0 && viewH > 0) centreCard(viewW, viewH)
  $: rulers = showRulers ? { h: rulerTicks(scrollX, viewW, originX, docSize.w, zoom), v: rulerTicks(scrollY, viewH, originY, docSize.h, zoom) } : null
  $: handleCommand($canvasCommand)
  $: dispatch('select', { id: selectedId })

  onMount(async () => {
    if ($activeSetId && !$cards.length) await loadSet($activeSetId)
    try { setSize = await window.spadewick.cardSize.get($activeSetId) } catch { /* optional */ }
    try { fontFamilies = [...new Set([...(await window.spadewick.fonts.list()).map(f => f.family_name), ...(await window.spadewick.fonts.bundled())])].sort((a, b) => a.localeCompare(b)) } catch { /* optional */ }
    try { if ((await window.spadewick.settings.get('canvas_smart_guides')) === false) smartGuides = false } catch { /* optional */ }

    // the stage is only as big as the view (it is moved and scaled over the card as the person scrolls and zooms), so zooming in close never
    // makes a canvas of millions of pixels for each layer
    stage = new Konva.Stage({ container: stageView, width: 10, height: 10 })
    bgLayer = new Konva.Layer({ listening: false })
    liveLayer = new Konva.Layer({ listening: false })   // stands in for the element being dragged (PRD §8.7.3)
    gridLayer = new Konva.Layer({ listening: false })
    printLayer = new Konva.Layer({ listening: false })
    uiLayer = new Konva.Layer()
    stage.add(bgLayer, liveLayer, gridLayer, printLayer, uiLayer)
    transformer = new Konva.Transformer({ rotateEnabled: true, rotationSnapTolerance: 5, ignoreStroke: true, borderStroke: '#0e7ded', borderStrokeWidth: 1.5, anchorStroke: '#0e7ded', anchorFill: '#ffffff', anchorStrokeWidth: 1.5, anchorSize: 9, anchorCornerRadius: 2 })
    uiLayer.add(transformer)
    stage.on('mousedown touchstart', onStageDown)
    stage.on('mouseup touchend', onStageUp)
    stage.on('mousemove touchmove', onStageMove)
    sourceChanged()
    syncView()
  })

  onDestroy(() => { destroyed = true; clearTimeout(renderTimer); clearTimeout(measureTimer); stage?.destroy() })

  // ---------------------------------------------------------------------------
  // Source <-> DOM
  // ---------------------------------------------------------------------------

  function parse(src = svgSource) {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml')
    return doc.querySelector('parsererror') ? null : doc
  }

  function commit(doc) {
    svgSource = new XMLSerializer().serializeToString(doc.documentElement)
    lastSource = null
    dispatch('change')
  }

  function mutate(fn) {
    const doc = parse()
    if (!doc) return
    fn(doc)
    commit(doc)
  }

  const elOf = (doc, id) => doc.querySelector(`[data-spadewick-id="${CSS.escape(id)}"]`)

  function sourceChanged() {
    if (!stage || svgSource === lastSource) return
    lastSource = svgSource
    const doc = parse()
    parseError = doc ? '' : tr('canvasEditor.invalidSource')
    if (!doc) { boxes = {}; rebuildHandles(); return }

    const root = doc.documentElement
    const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
    docSize = vb.length === 4 && vb[2] > 0
      ? { w: vb[2], h: vb[3] }
      : { w: parseFloat(root.getAttribute('width')) || 500, h: parseFloat(root.getAttribute('height')) || 700 }
    pad = Math.round(Math.max(docSize.w, docSize.h) * PASTEBOARD)

    // Measure on a live DOM copy so text and groups get real bounding boxes
    measureHost.innerHTML = stripActiveContent(withPreviewText(svgSource))
    const svg = measureHost.querySelector('svg')
    if (svg) { svg.setAttribute('width', docSize.w); svg.setAttribute('height', docSize.h) }
    boxes = {}
    // Positions are measured in card units: the card is the view box, so a view box that does not start at 0 0 (a design imported with its
    // bleed taken off, or a tool's artboard that starts elsewhere) moves everything by its origin
    const origin = vb.length === 4 && vb.every(Number.isFinite) ? { x: vb[0], y: vb[1] } : { x: 0, y: 0 }
    const rootInv = new DOMMatrix().translate(-origin.x, -origin.y).multiply(toMatrix(svg?.getScreenCTM()).inverse())
    for (const el of measureHost.querySelectorAll('[data-spadewick-id]')) boxes[el.getAttribute('data-spadewick-id')] = measure(el, rootInv)

    applySize()
    rebuildHandles()
    refreshProps()
    scheduleRender()
    if (pendingEdit && boxes[pendingEdit]) { const id = pendingEdit; pendingEdit = null; setTimeout(() => startEdit(id), 60) }   // after the click that made it has moved the focus
  }

  /**
   * Fill {{tokens}} inside text content with the preview card's values, so handles are sized for
   * real text instead of the placeholder. Only the measuring copy is changed, never the source.
   */
  function withPreviewText(src) {
    const card = $cards.find(c => c.id === cardId)
    if (!card) return src
    const index = $cards.findIndex(c => c.id === cardId)
    const values = { ...(card.fields ?? {}), display_name: card.display_name, '@card.id': card.card_code ?? '', '@card.number': String(index + 1), '@card.count': String($cards.length) }
    const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return src.replace(/>([^<]*\{\{[^<]*)</g, (m, text) =>
      `>${text.replace(/\{\{\s*(@card\.(?:id|number|count)|\w+)\s*\}\}/g, (t, slug) => (values[slug] != null && values[slug] !== '' ? esc(values[slug]) : t))}<`)
  }

  // Re-measure when the preview card changes (its text may be longer or shorter)
  function remeasureFor() {
    if (!stage) return
    lastSource = null
    sourceChanged()
  }
  $: remeasureFor(cardId)

  /**
   * The measuring copy only needs geometry. Remove anything that could run code or load resources
   * (scripts, event-handler attributes, foreignObject, external references) before it enters the page.
   */
  function stripActiveContent(src) {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml')
    if (doc.querySelector('parsererror')) return ''
    doc.querySelectorAll('script, foreignObject, iframe, object, embed').forEach(n => n.remove())
    for (const el of doc.querySelectorAll('*')) {
      for (const a of [...el.attributes]) {
        const name = a.name.toLowerCase(), value = a.value.trim().toLowerCase()
        if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && !value.startsWith('data:') && !value.startsWith('#') && !value.includes('{{'))) el.removeAttribute(a.name)
      }
    }
    return new XMLSerializer().serializeToString(doc.documentElement)
  }

  const toMatrix = m => (m ? DOMMatrix.fromMatrix(m) : new DOMMatrix())

  /**
   * Bounding box of `el` in root SVG units. Uses the live DOM's CTMs so transforms on the element
   * and on any ancestor group are honoured; a rotated element is shown by its axis-aligned bounds.
   */
  function measure(el, rootInv) {
    const tag = el.tagName.toLowerCase()
    const num = n => parseFloat(el.getAttribute(n))
    const hasBox = !Number.isNaN(num('width')) && !Number.isNaN(num('height'))
    // PRD §7.4: dynamic text uses its width/height attributes as a box whose y is the TOP edge
    const boxed = hasBox && (BOX_TAGS.includes(tag) || (tag === 'text' && el.hasAttribute('data-spadewick-field')))
    let local
    if (boxed) local = { x: num('x') || 0, y: num('y') || 0, w: num('width'), h: num('height') }
    else {
      try { const r = el.getBBox(); local = { x: r.x, y: r.y, w: r.width, h: r.height } }
      catch { local = { x: 0, y: 0, w: 0, h: 0 } }
    }
    const M = rootInv.multiply(toMatrix(el.getScreenCTM()))
    const P = rootInv.multiply(toMatrix(el.parentNode?.getScreenCTM?.()))
    const pts = [[local.x, local.y], [local.x + local.w, local.y], [local.x, local.y + local.h], [local.x + local.w, local.y + local.h]]
      .map(([x, y]) => M.transformPoint({ x, y }))
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    const minX = Math.min(...xs), minY = Math.min(...ys)
    const pInv = P.inverse()
    const mat = m => ({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f })
    return {
      x: minX, y: minY, w: Math.max(Math.max(...xs) - minX, 4), h: Math.max(Math.max(...ys) - minY, 4), tag,
      M: mat(M), P: mat(P),                                            // this element's and its parent's place on the card: a resize is written as a transform
      container: tag === 'g' && !!el.querySelector('[data-spadewick-id]'),   // a group of layers: its own area is not a target, its layers are
      local, hasBox: boxed,
      sx: Math.hypot(M.a, M.b) || 1, sy: Math.hypot(M.c, M.d) || 1,
      rotated: Math.abs(M.b) > 1e-6 || Math.abs(M.c) > 1e-6 || M.a < 0 || M.d < 0,
      pLin: { a: pInv.a, b: pInv.b, c: pInv.c, d: pInv.d },
      fontSize: parseFloat(getComputedStyle(el).fontSize) || 16
    }
  }

  // ---------------------------------------------------------------------------
  // Background render (real card data via the main-process pipeline)
  // ---------------------------------------------------------------------------

  function scheduleRender() {
    clearTimeout(renderTimer)
    renderTimer = setTimeout(renderBackground, 200)
  }

  /** A copy of the source with some elements hidden. Used for the preview only: the template itself is never changed. */
  function withHidden(src, ids) {
    if (!ids.length) return src
    const doc = parse(src)
    if (!doc) return src
    for (const id of ids) elOf(doc, id)?.setAttribute('display', 'none')
    return new XMLSerializer().serializeToString(doc.documentElement)
  }

  /** The width the card is drawn at: its own width at 100% (one pixel per unit), more when zoomed in or on a sharp screen, so it stays crisp. */
  const renderPx = () => { const w = docSize.w + 2 * pad; return Math.min(2400, Math.max(Math.round(w), Math.round(w * zoom * dpr()))) }

  /** The source drawn on the card and the pasteboard around it: the view box reaches `pad` further on every side. Only for the picture on screen. */
  function withPasteboard(src) {
    const doc = parse(src)
    if (!doc) return src
    const root = doc.documentElement
    const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
    if (vb.length !== 4 || !vb.every(Number.isFinite) || !(vb[2] > 0)) return src
    root.setAttribute('viewBox', `${vb[0] - pad} ${vb[1] - pad} ${vb[2] + 2 * pad} ${vb[3] + 2 * pad}`)
    root.removeAttribute('width'); root.removeAttribute('height')
    return new XMLSerializer().serializeToString(root)
  }

  async function renderPng(src) {
    lastRenderPx = renderPx()
    const b64 = await window.spadewick.templates.render({ cardId, templateId, svgSource: withPasteboard(src), width: lastRenderPx })
    return `data:image/png;base64,${b64}`
  }

  const loadImage = src => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src })

  let fitReport = []            // how each text element fitted in the last render (PRD §16.6)
  $: fitFor = props ? fitReport.find(f => f.where.id === selectedId) ?? null : null
  let fullImg = null            // the last full render of the card
  let rerenderAfterDrag = false

  async function renderBackground() {
    if (destroyed || !bgLayer) return
    if (dragging) { rerenderAfterDrag = true; return }   // the picture is replaced when the drag ends
    let src = null
    renderError = ''
    const source = withHidden(svgSource, [...hiddenIds])
    if (cardId && templateId && !parseError) {
      try { src = await renderPng(source) } catch (err) { renderError = err.message }
      window.spadewick.templates.textReport({ cardId, templateId, svgSource: source }).then(r => { fitReport = r.fits }).catch(() => { fitReport = [] })
    }
    // Fallback: the raw template (tokens unsubstituted)
    if (!src && !parseError) src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withPasteboard(source))}`
    if (!src) return
    const img = await loadImage(src)
    if (destroyed || !img) return
    if (dragging) { rerenderAfterDrag = true; return }
    fullImg = img
    bgNode?.destroy()
    bgNode = new Konva.Image({ image: img, x: -pad, y: -pad, width: docSize.w + 2 * pad, height: docSize.h + 2 * pad })
    bgLayer.add(bgNode)
    bgNode.moveToBottom()   // under the veil that dims what lies outside the card
    bgLayer.batchDraw()
    clearLive()   // the real picture now shows the element at its new size
    prepareLive()
  }

  $: if (cardId) scheduleRender()

  // ---------------------------------------------------------------------------
  // Overlay handles
  // ---------------------------------------------------------------------------

  /** Which transformer anchors an element offers. Rotated elements and groups can only be moved. */
  function anchorsFor(b) {
    if (b.rotated) return []
    // Text without a box has no size of its own: corner handles scale the font proportionally
    if ((b.tag === 'text' && !b.hasBox) || b.tag === 'circle') return ['top-left', 'top-right', 'bottom-left', 'bottom-right']
    return ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
  }

  const handleNode = id => uiLayer?.findOne(n => n.name() === 'handle' && n.id() === id) ?? null

  function rebuildHandles() {
    if (!uiLayer) return
    uiLayer.find('.handle').forEach(n => n.destroy())
    groupNode?.destroy(); groupNode = null
    transformer.nodes([])
    for (const [id, b] of Object.entries(boxes)) {
      if (hiddenIds.has(id)) continue   // hidden in the layers panel: nothing to grab
      const locked = lockedIds.has(id)
      const node = new Konva.Rect({
        name: 'handle', id, x: b.x, y: b.y, width: b.w, height: b.h,
        stroke: 'rgba(14,125,237,0)', strokeWidth: 1.5, strokeScaleEnabled: false,
        fill: 'rgba(14,125,237,0)', draggable: tool === 'select' && !locked, listening: !locked && !(b.container && !selectedIds.includes(id))
      })
      // An element is outlined when the pointer is over it, and by the handles once it is selected
      node.on('mouseenter', () => { if (tool === 'select' && !dragging && !selectedIds.includes(id)) { node.stroke('rgba(14,125,237,.95)'); node.fill('rgba(14,125,237,.07)'); stage.container().style.cursor = 'move'; uiLayer.batchDraw() } })
      node.on('mouseleave', () => { node.stroke('rgba(14,125,237,0)'); node.fill('rgba(14,125,237,0)'); stage.container().style.cursor = ''; uiLayer.batchDraw() })
      node.on('mousedown touchstart', e => {
        if (tool !== 'select') return
        e.cancelBubble = true
        if (e.evt?.shiftKey || e.evt?.ctrlKey || e.evt?.metaKey) { toggleSelect(id); return }   // add to or take out of the selection
        if (selectedIds.length > 1 && selectedIds.includes(id)) { collapseOnClick = id; return }  // keep the group for a drag; a click alone narrows it
        select(id)
      })
      node.on('dblclick dbltap', () => { if (tool === 'select') startEdit(id) })
      node.on('mouseup touchend', () => { if (collapseOnClick === id) { collapseOnClick = null; select(id) } })
      node.on('dragstart', () => { collapseOnClick = null; beginDrag(node) })
      node.on('transformstart', () => beginDrag(node))
      node.on('dragmove', e => onNodeMove(node, e, false))
      node.on('transform', e => onNodeMove(node, e, true))
      node.on('dragend', () => endDrag(node))
      node.on('transformend', () => endDrag(node))
      uiLayer.add(node)
    }
    const keep = selectedIds.filter(id => boxes[id])
    if (!keep.length && selectedId && boxes[selectedId]) keep.push(selectedId)
    if (keep.length) setSelection(keep, false)
    else { selectedIds = []; selectedId = null; props = null }
    uiLayer.batchDraw()
  }

  let appliedFocus = 0
  function applyFocus(f) {
    appliedFocus = f.n
    if (f.cardId && $cards.some(c => c.id === f.cardId)) cardId = f.cardId
    select(f.id)
  }

  /** Select exactly these elements; the last one is the one the properties panel shows. */
  function setSelection(ids, refresh = true) {
    const next = [...new Set(ids)].filter(id => boxes[id])
    selectedIds = next
    selectedId = next.length ? next[next.length - 1] : null
    syncContainerHits()
    applyTransformer()
    if (refresh) { refreshProps(); prepareLive() }
    uiLayer?.batchDraw()
  }

  const select = (id, refresh = true) => setSelection(id ? [id] : [], refresh)
  const toggleSelect = id => setSelection(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])

  /** A group that holds layers of its own is a target only while it is selected (from the Layers panel): a click on empty space inside it must not grab it. */
  function syncContainerHits() {
    if (!uiLayer) return
    for (const n of uiLayer.find('.handle')) { if (boxes[n.id()]?.container) n.listening(!lockedIds.has(n.id()) && selectedIds.includes(n.id())) }
  }

  /** The handles of what is selected: one element offers the resize handles it can use, several offer them as one block. */
  function applyTransformer() {
    if (!transformer) return
    // A hidden or locked element can be selected from the layers panel, but has no handle to drag
    const nodes = selectedIds.filter(id => !lockedIds.has(id)).map(handleNode).filter(Boolean)
    groupNode?.destroy(); groupNode = null
    if (!nodes.length) { transformer.nodes([]); return }
    if (nodes.length === 1) {
      transformer.nodes(nodes)
      const b = boxes[nodes[0].id()]
      transformer.enabledAnchors(anchorsFor(b))
      transformer.keepRatio(keepRatioFor(b))
      transformer.rotateEnabled(!lockedIds.has(nodes[0].id()))
    } else {
      // Several: one block that stands for them, below their own handles (so a click on an element still reaches it)
      const bb = boundsOf(nodes.map(rectOf))
      groupNode = new Konva.Rect({ name: 'groupbox', x: bb.x, y: bb.y, width: bb.w, height: bb.h, stroke: 'rgba(14,125,237,0)', fill: 'rgba(14,125,237,0)', strokeScaleEnabled: false, draggable: tool === 'select' })
      groupNode.on('dragstart', () => beginGroupDrag(groupNode))
      groupNode.on('dragmove', e => moveGroup(groupNode, !!e?.evt?.altKey))
      groupNode.on('dragend', () => endGroupDrag())
      groupNode.on('transformstart', () => beginMultiTransform())
      groupNode.on('transform', () => followBlock())
      groupNode.on('transformend', () => endMultiTransform())
      uiLayer.add(groupNode)
      groupNode.moveToBottom()
      const plain = nodes.every(n => { const b = boxes[n.id()]; return b && !b.rotated && b.tag !== 'g' })
      transformer.nodes([groupNode])
      transformer.enabledAnchors(plain ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center'] : [])
      transformer.keepRatio(lockAspect)
      transformer.rotateEnabled(false)
    }
    // The resize handles must sit above every element's click area. The transformer was added before the
    // handles, so without this an overlapping element's handle covers its corners and takes the click (PRD Fixes F4).
    transformer.moveToTop()
  }

  function deselect() { setSelection([], false); props = null; liveBase = null }

  const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  function selectAll() {
    const doc = parse(); if (!doc) return
    setSelection(topLevel(doc, Object.keys(boxes)).filter(id => !hiddenIds.has(id) && !lockedIds.has(id)))
  }

  // A rubber band on empty canvas selects what it touches; with Shift it adds to the selection
  function startMarquee(additive) {
    const p = stage.getRelativePointerPosition()
    const node = new Konva.Rect({ x: p.x, y: p.y, width: 0, height: 0, stroke: '#0e7ded', strokeWidth: 1, strokeScaleEnabled: false, dash: [4, 3], fill: 'rgba(14,125,237,.08)', listening: false })
    uiLayer.add(node)
    marquee = { x0: p.x, y0: p.y, node, additive }
  }
  function moveMarquee() {
    const p = stage.getRelativePointerPosition()
    marquee.node.setAttrs({ x: Math.min(p.x, marquee.x0), y: Math.min(p.y, marquee.y0), width: Math.abs(p.x - marquee.x0), height: Math.abs(p.y - marquee.y0) })
    uiLayer.batchDraw()
  }
  function finishMarquee() {
    if (!marquee) return
    const m = marquee
    marquee = null
    const r = { x: m.node.x(), y: m.node.y(), w: m.node.width(), h: m.node.height() }
    m.node.destroy(); uiLayer.batchDraw()
    if (r.w < 3 / zoom && r.h < 3 / zoom) { if (!m.additive) deselect(); return }       // a click on empty canvas
    const hits = Object.entries(boxes).filter(([id, b]) => !hiddenIds.has(id) && !lockedIds.has(id) && intersects(b, r)).map(([id]) => id)
    setSelection(m.additive ? [...selectedIds, ...hits] : hits)
  }

  const keepRatioFor = b => lockAspect || b.tag === 'circle' || (b.tag === 'text' && !b.hasBox)

  const snapTo = v => snap ? Math.round(v / (showGrid ? GRID : 1)) * (showGrid ? GRID : 1) : v

  // ---------------------------------------------------------------------------
  // Dragging: snapping, alignment guides and the live stand-in for the element (PRD §8.7.3, §8.7.4)
  // ---------------------------------------------------------------------------

  let dragging = false
  let activeNode = null
  let cancelled = false

  const rectOf = node => ({ x: node.x(), y: node.y(), w: node.width() * node.scaleX(), h: node.height() * node.scaleY() })
  const edgesOf = anchor => ({ left: !!anchor?.includes('left'), right: !!anchor?.includes('right'), top: !!anchor?.includes('top'), bottom: !!anchor?.includes('bottom') })

  function beginDrag(node) {
    if (multi && selectedIds.includes(node.id())) { beginGroupDrag(node); return }
    dragging = true
    activeNode = node
    cancelled = false
    transformer.rotationSnaps(shiftHeld ? ROTATION_STEPS : [])       // Shift: the angle snaps to every 15 degrees
    beginLive()
  }

  function onNodeMove(node, e, resizing) {
    if (groupDrag) { moveGroup(node, !!e?.evt?.altKey); return }
    if (Math.abs(node.rotation()) > 0.001) { clearGuides(); drawAngle(node); return }   // being turned: the handle follows, nothing is snapped
    snapNode(node, resizing, !!e?.evt?.altKey)
    drawReadout(rectOf(node), resizing)
    updateLive(rectOf(node))
    scheduleLiveText(node)
  }

  function endDrag(node) {
    if (groupDrag) { endGroupDrag(); return }
    clearGuides()
    dragging = false
    activeNode = null
    stopLiveText()
    const turned = node.rotation()
    if (cancelled) { cancelled = false; restoreNode(node) }
    else if (Math.abs(turned) > 0.001) {
      const b = boxes[node.id()]
      node.rotation(0)
      if (b) { node.position({ x: b.x, y: b.y }); node.size({ width: b.w, height: b.h }); node.scale({ x: 1, y: 1 }) }
      turnBy(node.id(), turned)
    } else applyNodeGeometry(node)
    rerenderAfterDrag = false
    scheduleRender()   // also covers a drag that changed nothing in the source
  }

  /** Escape during a drag: put the handle and the picture back as they were. Nothing was written to the SVG. */
  function restoreNode(node) {
    const b = boxes[node.id()]
    node.rotation(0)
    if (b) { node.position({ x: b.x, y: b.y }); node.size({ width: b.w, height: b.h }); node.scale({ x: 1, y: 1 }) }
    if (bgNode && fullImg) bgNode.image(fullImg)
    clearLive()
    bgLayer?.batchDraw()
    uiLayer?.batchDraw()
  }

  // ---- several elements at once ----

  /** Dragging an element of the selection, or the block around it, moves them all. */
  function beginGroupDrag(node) {
    const members = selectedIds.filter(id => !lockedIds.has(id)).map(handleNode).filter(Boolean)
    const rects = new Map(members.map(n => [n.id(), { x: n.x(), y: n.y(), w: n.width(), h: n.height() }]))
    const bbox = boundsOf([...rects.values()])
    groupDrag = { ref: node, members, rects, bbox, refStart: node === groupNode ? { x: bbox.x, y: bbox.y } : { ...rects.get(node.id()) } }
    dragging = true; activeNode = node; cancelled = false
  }

  /** The block is snapped like one element: to the card, to the others, to the grid. */
  function moveGroup(node, altKey) {
    const g = groupDrag
    if (!g) return
    let rect = { x: g.bbox.x + (node.x() - g.refStart.x), y: g.bbox.y + (node.y() - g.refStart.y), w: g.bbox.w, h: g.bbox.h }
    clearGuides()
    let sx = false, sy = false
    const others = Object.entries(boxes).filter(([id, b]) => !selectedIds.includes(id) && !hiddenIds.has(id) && b.w > 0 && b.h > 0).map(([, b]) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))
    if (smartGuides && !altKey) {
      const r = snapRect(rect, buildTargets(docSize, others), SNAP_PX / zoom)
      rect = r.rect; sx = r.snappedX; sy = r.snappedY
      drawGuides(r.guides)
    }
    if (!sx) rect.x = snapTo(rect.x)
    if (!sy) rect.y = snapTo(rect.y)
    const dx = rect.x - g.bbox.x, dy = rect.y - g.bbox.y
    for (const n of g.members) { const r0 = g.rects.get(n.id()); n.position({ x: r0.x + dx, y: r0.y + dy }) }
    groupNode?.position({ x: rect.x, y: rect.y })
    drawReadout(rect, false)
  }

  function endGroupDrag() {
    const g = groupDrag
    if (!g) return
    groupDrag = null
    clearGuides()
    dragging = false; activeNode = null
    if (cancelled) {
      cancelled = false
      for (const n of g.members) { const r0 = g.rects.get(n.id()); n.position({ x: r0.x, y: r0.y }) }
      groupNode?.position({ x: g.bbox.x, y: g.bbox.y })
      uiLayer?.batchDraw()
      return
    }
    const doc = parse()
    const top = doc ? topLevel(doc, g.members.map(n => n.id())) : []
    const list = []
    for (const n of g.members) {
      const old = boxes[n.id()]
      if (!old || !top.includes(n.id())) continue
      if (Math.abs(n.x() - old.x) > 1e-6 || Math.abs(n.y() - old.y) > 1e-6) list.push({ id: n.id(), old, nb: { x: n.x(), y: n.y(), w: old.w, h: old.h } })
    }
    if (list.length) writeGeometries(list)
    rerenderAfterDrag = false
    scheduleRender()
  }

  // Resizing the block scales every element with it
  let blockXf = null
  function beginMultiTransform() {
    const members = selectedIds.filter(id => !lockedIds.has(id)).map(handleNode).filter(Boolean)
    const rects = new Map(members.map(n => [n.id(), { x: n.x(), y: n.y(), w: n.width(), h: n.height() }]))
    blockXf = { members, rects, bbox: boundsOf([...rects.values()]) }
    dragging = true; cancelled = false
  }
  function followBlock() {
    const t = blockXf
    if (!t || !groupNode) return
    const sx = (groupNode.width() * groupNode.scaleX()) / t.bbox.w, sy = (groupNode.height() * groupNode.scaleY()) / t.bbox.h
    for (const n of t.members) {
      const r0 = t.rects.get(n.id())
      n.position({ x: groupNode.x() + (r0.x - t.bbox.x) * sx, y: groupNode.y() + (r0.y - t.bbox.y) * sy })
      n.size({ width: Math.max(4, r0.w * sx), height: Math.max(4, r0.h * sy) })
    }
    clearGuides()
    drawReadout({ x: groupNode.x(), y: groupNode.y(), w: groupNode.width() * groupNode.scaleX(), h: groupNode.height() * groupNode.scaleY() }, true)
  }
  function endMultiTransform() {
    const t = blockXf
    blockXf = null
    const wasCancelled = cancelled
    cancelled = false
    dragging = false
    clearGuides()
    if (!t) return
    const doc = parse()
    const top = doc ? topLevel(doc, t.members.map(n => n.id())) : []
    const list = []
    for (const n of t.members) {
      const old = boxes[n.id()]
      if (wasCancelled || !old || !top.includes(n.id())) { const r0 = t.rects.get(n.id()); n.position({ x: r0.x, y: r0.y }); n.size({ width: r0.w, height: r0.h }); continue }
      list.push({ id: n.id(), old, nb: { x: n.x(), y: n.y(), w: Math.max(4, n.width()), h: Math.max(4, n.height()) } })
    }
    if (groupNode) { groupNode.scale({ x: 1, y: 1 }); groupNode.setAttrs({ x: t.bbox.x, y: t.bbox.y, width: t.bbox.w, height: t.bbox.h }) }
    if (list.length) writeGeometries(list)
    scheduleRender()
  }

  function snapNode(node, resizing = false, altKey = false) {
    let rect = rectOf(node)
    let snappedX = false, snappedY = false
    clearGuides()
    const others = Object.entries(boxes)
      .filter(([id, b]) => id !== selectedId && !hiddenIds.has(id) && b.w > 0 && b.h > 0)
      .map(([, b]) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))
    // Guides do not apply to a resize that keeps the aspect ratio: moving one edge by itself would break the ratio
    if (smartGuides && !altKey && !(resizing && transformer.keepRatio())) {
      const r = snapRect(rect, buildTargets(docSize, others), SNAP_PX / zoom, resizing ? edgesOf(transformer.getActiveAnchor()) : undefined)
      rect = r.rect; snappedX = r.snappedX; snappedY = r.snappedY
      drawGuides(r.guides)
    }
    // Pixel or grid snapping (the Snap toggle) applies on any axis no guide caught
    if (!snappedX) rect.x = snapTo(rect.x)
    if (!snappedY) rect.y = snapTo(rect.y)
    node.x(rect.x); node.y(rect.y)
    if (resizing) {
      node.width(Math.max(4, snappedX ? rect.w : snapTo(rect.w))); node.height(Math.max(4, snappedY ? rect.h : snapTo(rect.h)))
      node.scale({ x: 1, y: 1 })
    }
    if (smartGuides && !altKey) drawGaps(gapsFor(rectOf(node), others))
  }

  function guideColor() {
    // Konva draws pixels, which forced-colours mode cannot recolour: ask the browser for the system colour
    if (window.matchMedia?.('(forced-colors: active)').matches && measureHost) {
      measureHost.style.color = 'Highlight'
      const c = getComputedStyle(measureHost).color
      measureHost.style.color = ''
      return c
    }
    return '#e5007e'   // 3:1 or better against the card (white) and the canvas background, in both themes
  }

  function drawGuides(guides) {
    if (!guides.length) return
    const stroke = guideColor()
    for (const g of guides) {
      uiLayer.add(new Konva.Line({
        name: 'guide', listening: false, stroke, strokeWidth: 1, strokeScaleEnabled: false,
        points: g.axis === 'x' ? [g.pos, g.from, g.pos, g.to] : [g.from, g.pos, g.to, g.pos]
      }))
    }
    uiLayer.batchDraw()
  }

  /** Distance labels between the dragged element and its nearest neighbours; equal gaps are drawn heavier. */
  function drawGaps(gaps) {
    if (!gaps.length) return
    const stroke = guideColor()
    for (const g of gaps) {
      const points = g.axis === 'x' ? [g.from, g.at, g.to, g.at] : [g.at, g.from, g.at, g.to]
      uiLayer.add(new Konva.Line({ name: 'guide', listening: false, stroke, strokeWidth: g.equal ? 2 : 1, strokeScaleEnabled: false, points }))
      const label = new Konva.Label({ name: 'guide', listening: false, x: g.axis === 'x' ? (g.from + g.to) / 2 : g.at, y: g.axis === 'x' ? g.at : (g.from + g.to) / 2 })
      label.add(new Konva.Tag({ fill: stroke }))
      label.add(new Konva.Text({ text: String(Math.round(g.size * 10) / 10), fontSize: 10, padding: 2, fill: '#ffffff' }))
      label.offset({ x: label.width() / 2, y: label.height() / 2 })
      label.scale({ x: 1 / zoom, y: 1 / zoom })
      uiLayer.add(label)
    }
    uiLayer.batchDraw()
  }

  const ROTATION_STEPS = Array.from({ length: 24 }, (_, i) => i * 15)

  /** Turn an element by `delta` degrees from the angle it has (written as rotate(angle cx cy), PRD §8.4). */
  function turnBy(id, delta) {
    const doc = parse(); const el = doc && elOf(doc, id)
    if (!el) return
    let a = Number((/rotate\(\s*(-?[\d.]+)/.exec(el.getAttribute('transform') || '') || [])[1] ?? 0) + delta
    a = ((a + 180) % 360 + 360) % 360 - 180                       // between -180 and 180
    setRotation(Math.round(a * 100) / 100)
  }

  function drawAngle(node) {
    const a = Number(props?.rotation ?? 0)
    const total = Math.round((((a + node.rotation() + 180) % 360 + 360) % 360 - 180) * 10) / 10
    const r = rectOf(node)
    const label = new Konva.Label({ name: 'guide', listening: false, x: r.x + r.w / 2, y: r.y + r.h + 10 / zoom })
    label.add(new Konva.Tag({ fill: '#3b2fb8', cornerRadius: 4 }))
    label.add(new Konva.Text({ text: `${total}°`, fontSize: 11, padding: 4, fill: '#ffffff' }))
    label.offset({ x: label.width() / 2, y: 0 })
    label.scale({ x: 1 / zoom, y: 1 / zoom })
    uiLayer.add(label)
    uiLayer.batchDraw()
  }

  /** A small label under the element while it is dragged or resized: its size, or its position. */
  function drawReadout(r, resizing) {
    const round = v => Math.round(v * 10) / 10
    const label = new Konva.Label({ name: 'guide', listening: false, x: r.x + r.w / 2, y: r.y + r.h + 10 / zoom })
    label.add(new Konva.Tag({ fill: '#3b2fb8', cornerRadius: 4 }))
    label.add(new Konva.Text({ text: resizing ? `${round(r.w)} × ${round(r.h)}` : `${round(r.x)}, ${round(r.y)}`, fontSize: 11, padding: 4, fill: '#ffffff' }))
    label.offset({ x: label.width() / 2, y: 0 })
    label.scale({ x: 1 / zoom, y: 1 / zoom })
    uiLayer.add(label)
    uiLayer.batchDraw()
  }

  function clearGuides() {
    const lines = uiLayer?.find('.guide') ?? []
    if (!lines.length) return
    lines.forEach(n => n.destroy())
    uiLayer.batchDraw()
  }

  function toggleGuides() {
    smartGuides = !smartGuides
    if (!smartGuides) clearGuides()
    window.spadewick.settings.set('canvas_smart_guides', smartGuides).catch(() => { /* the toggle still works for this session */ })
  }

  // --- live stand-in -----------------------------------------------------------------------------
  // The picture on the canvas is rendered by the main process, so it cannot follow a handle. While an
  // element is selected we keep a render of the card WITHOUT it; during a drag that render is shown and the
  // element is drawn here, following the handle every frame. On release the normal render replaces both.

  let live = null        // { group, shape, spec } while a drag is running (or until the real render arrives)
  let liveBase = null    // { id, source, img, spec }: the card rendered without the selected element
  let liveToken = 0
  const pictures = new Map()   // asset id -> Promise<{ img, w, h } | null>

  /** A preview picture of a library image (at most 2048 px), fetched once. */
  function picture(assetId) {
    if (!pictures.has(assetId)) {
      pictures.set(assetId, (async () => {
        try {
          const res = await window.spadewick.assets.getPreview(assetId)
          if (!res?.bytes?.length) return null
          const img = await loadImage(URL.createObjectURL(new Blob([res.bytes], { type: res.mime })))
          return img && img.naturalWidth > 0 ? { img, w: img.naturalWidth, h: img.naturalHeight } : null
        } catch { return null }
      })())
    }
    return pictures.get(assetId)
  }

  /** The library asset an image element shows on the preview card: a fixed image, or the card's image field. */
  function assetIdOf(el) {
    const href = el.getAttribute('href') || el.getAttribute('xlink:href') || ''
    const fixed = ASSET_TOKEN.exec(href)
    if (fixed) return fixed[1]
    const slug = (/^\{\{\s*(\w+)\s*\}\}$/.exec(href.trim()) || [])[1]
    const value = slug && $cards.find(c => c.id === cardId)?.fields?.[slug]
    return typeof value === 'string' && value.startsWith('asset:') ? value.slice(6) : null
  }

  /** A paint value as a colour Konva understands: '' for none, null when it cannot be known here (a field token or gradient). */
  function paintOf(value, fallback) {
    const t = String(value ?? fallback).trim()
    if (t.includes('{{') || t.startsWith('url(') || t === 'currentColor') return null
    return t === 'none' ? '' : t
  }

  /** What to draw for the selected element, or null when it can only show an outline while it is dragged. */
  async function liveSpec(el, b) {
    const style = el.getAttribute('style') || ''
    if (/fill|stroke|opacity|transform|mix-blend|filter/.test(style) || el.hasAttribute('filter')) return null
    const opacity = parseFloat(el.getAttribute('opacity') ?? '1')
    const num = n => parseFloat(el.getAttribute(n)) || 0
    if (b.tag === 'image') {
      const id = assetIdOf(el)
      const pic = id && await picture(id)
      return pic ? { kind: 'image', pic, par: el.getAttribute('preserveAspectRatio'), opacity } : null
    }
    const fill = paintOf(el.getAttribute('fill'), 'black'), stroke = paintOf(el.getAttribute('stroke'), 'none')
    if (fill === null || stroke === null) return null
    const base = { fill, stroke, strokeWidth: num('stroke-width') * b.sx || (stroke ? b.sx : 0), opacity: Number.isNaN(opacity) ? 1 : opacity }
    if (b.tag === 'rect') return { kind: 'rect', rx: num('rx') * b.sx, ...base }
    if (b.tag === 'ellipse' || b.tag === 'circle') return { kind: 'ellipse', ...base }
    return null
  }

  /** Prepare, in the background, what a drag of the selected element will need. Never blocks a drag. */
  async function prepareLive() {
    const id = selectedId
    if (!id || !stage || parseError || !cardId || !templateId) return
    if (liveBase && liveBase.id === id && liveBase.source === svgSource) return
    liveBase = null
    const b = boxes[id]
    if (!b || b.rotated || Math.abs(b.sx - b.sy) > 1e-3 || lockedIds.has(id) || hiddenIds.has(id)) return
    const source = svgSource
    const token = ++liveToken
    const doc = parse(source)
    const el = doc && elOf(doc, id)
    if (!el) return
    try {
      const spec = await liveSpec(el, b)
      if (!spec) return
      const img = await loadImage(await renderPng(withHidden(source, [...hiddenIds, id])))
      if (!img || destroyed || token !== liveToken || selectedId !== id || svgSource !== source) return
      liveBase = { id, source, img, spec }
    } catch { /* a drag then shows only the outline, as before */ }
  }

  function beginLive() {
    clearLive()
    if (!liveBase || liveBase.id !== selectedId || liveBase.source !== svgSource || !bgNode) return
    const { spec } = liveBase
    const group = new Konva.Group({ listening: false, opacity: spec.opacity })
    let shape
    if (spec.kind === 'image') shape = new Konva.Image({ image: spec.pic.img })
    else if (spec.kind === 'rect') shape = new Konva.Rect({ fill: spec.fill || undefined, stroke: spec.stroke || undefined, strokeWidth: spec.strokeWidth, cornerRadius: spec.rx })
    else shape = new Konva.Ellipse({ fill: spec.fill || undefined, stroke: spec.stroke || undefined, strokeWidth: spec.strokeWidth })
    group.add(shape)
    liveLayer.add(group)
    live = { group, shape, spec }
    bgNode.image(liveBase.img)
    bgLayer.batchDraw()
    updateLive(rectOf(activeNode))
  }

  function updateLive(box) {
    if (!live) return
    const { spec, group, shape } = live
    if (spec.kind === 'image') {
      const f = fitImage(box, { w: spec.pic.w, h: spec.pic.h }, spec.par)
      shape.setAttrs({ x: f.x, y: f.y, width: f.w, height: f.h })
      group.clip({ x: box.x, y: box.y, width: box.w, height: box.h })
    } else if (spec.kind === 'rect') shape.setAttrs({ x: box.x, y: box.y, width: box.w, height: box.h })
    else shape.setAttrs({ x: box.x + box.w / 2, y: box.y + box.h / 2, radiusX: box.w / 2, radiusY: box.h / 2 })
    liveLayer.batchDraw()
  }

  function clearLive() {
    if (!live) return
    live.group.destroy()
    live = null
    liveLayer?.batchDraw()
  }

  // --- live text and groups ----------------------------------------------------------------------
  // Text and groups cannot be drawn by the editor itself: their wrapping and shrinking are worked out by the text engine in
  // the main process. While one is dragged, the card is therefore rendered again with the element at its dragged place, at
  // most every 120 ms (PRD §8.7.3), so the picture follows with a short lag. Nothing is written to the SVG until release.

  const LIVE_TEXT_MS = 120
  let liveText = { timer: null, busy: false, pending: null }

  function scheduleLiveText(node) {
    if (live || !dragging || cancelled || !bgNode || !cardId || !templateId || parseError) return   // images and shapes have their own stand-in
    const id = node.id()
    const old = boxes[id]
    if (!old) return
    const r = rectOf(node)
    liveText.pending = { id, old, nb: { x: r.x, y: r.y, w: Math.max(4, r.w), h: Math.max(4, r.h) } }
    if (!liveText.timer && !liveText.busy) liveText.timer = setTimeout(runLiveText, LIVE_TEXT_MS)
  }

  async function runLiveText() {
    liveText.timer = null
    const job = liveText.pending
    if (!job || !dragging) return
    liveText.pending = null
    liveText.busy = true
    const mine = liveText
    try {
      const doc = parse(svgSource)
      if (doc) {
        geometryApplied(doc, job.id, job.old, job.nb)
        const img = await loadImage(await renderPng(withHidden(new XMLSerializer().serializeToString(doc.documentElement), [...hiddenIds])))
        if (img && dragging && !cancelled && bgNode && mine === liveText) { bgNode.image(img); bgLayer.batchDraw() }
      }
    } catch { /* the outline alone is shown, as before */ }
    mine.busy = false
    if (mine === liveText && liveText.pending && dragging) liveText.timer = setTimeout(runLiveText, 0)
  }

  function stopLiveText() {
    clearTimeout(liveText.timer)
    liveText = { timer: null, busy: false, pending: null }
  }

  function applyNodeGeometry(node) {
    const id = node.id()
    const old = boxes[id]
    if (!old) return
    const nb = { x: node.x(), y: node.y(), w: Math.max(4, node.width() * node.scaleX()), h: Math.max(4, node.height() * node.scaleY()) }
    node.scale({ x: 1, y: 1 })
    writeGeometry(id, old, nb)
  }

  // Write geometry back as x / y / width / height / transform (PRD §8.2). Everything is computed from the
  // difference between the measured root-space box and the requested one, then converted into the
  // element's own coordinate system so ancestor transforms keep working.
  function writeGeometry(id, old, nb) { mutate(doc => geometryApplied(doc, id, old, nb)) }
  /** Several elements moved or resized in one edit: one step of undo. */
  function writeGeometries(list) { mutate(doc => { for (const e of list) geometryApplied(doc, e.id, e.old, e.nb) }) }

  /** Put the requested box into `doc` (the one place that knows how; the live preview of text and groups uses it on a copy). */
  function geometryApplied(doc, id, old, nb) {
    {
      const el = elOf(doc, id); if (!el) return
      const tag = el.tagName.toLowerCase()
      const num = (n, d = 0) => { const v = parseFloat(el.getAttribute(n)); return Number.isNaN(v) ? d : v }
      const r = v => String(Math.round(v * 100) / 100)
      const dx = nb.x - old.x, dy = nb.y - old.y
      const handled = ['circle', 'ellipse', 'text', ...BOX_TAGS].includes(tag)   // elements with a size of their own: written as attributes

      const resized = Math.abs(nb.w - old.w) > 1e-6 || Math.abs(nb.h - old.h) > 1e-6
      if (!old.rotated && !handled && resized && old.M && old.P) {
        // A group, a path, a polygon, a line...: no size of its own, so it is scaled by a transform. The new transform maps the element's own
        // drawing through the card (old.M), scales the old box onto the new one there, and comes back into the parent's space (old.P).
        const sx = nb.w / old.w, sy = nb.h / old.h
        const S = new DOMMatrix([sx, 0, 0, sy, nb.x - old.x * sx, nb.y - old.y * sy])
        const T = DOMMatrix.fromMatrix(old.P).inverse().multiply(S).multiply(DOMMatrix.fromMatrix(old.M))
        el.setAttribute('transform', `matrix(${[T.a, T.b, T.c, T.d, T.e, T.f].map(v => Math.round(v * 1e6) / 1e6).join(' ')})`)
        return
      }

      if (!resized && dx === 0 && dy === 0) return   // nothing to write (a value typed again, a click that did not move)

      if (old.rotated || tag === 'g' || !handled) {
        // Move via a translate in the parent's coordinate space (the element keeps its own transform)
        const { a, b, c, d } = old.pLin
        const tx = a * dx + c * dy, ty = b * dx + d * dy
        const rest = el.getAttribute('transform') || ''
        el.setAttribute('transform', `translate(${r(tx)} ${r(ty)}) ${rest}`.trim())
        return
      }

      const dxl = dx / old.sx, dyl = dy / old.sy
      const wl = nb.w / old.sx, hl = nb.h / old.sy
      if (tag === 'circle') {
        el.setAttribute('cx', r(num('cx') + (nb.x + nb.w / 2 - old.x - old.w / 2) / old.sx))
        el.setAttribute('cy', r(num('cy') + (nb.y + nb.h / 2 - old.y - old.h / 2) / old.sy))
        el.setAttribute('r', r(Math.min(wl, hl) / 2))
      } else if (tag === 'ellipse') {
        el.setAttribute('cx', r(num('cx') + (nb.x + nb.w / 2 - old.x - old.w / 2) / old.sx))
        el.setAttribute('cy', r(num('cy') + (nb.y + nb.h / 2 - old.y - old.h / 2) / old.sy))
        el.setAttribute('rx', r(wl / 2)); el.setAttribute('ry', r(hl / 2))
      } else if (tag === 'text' && !old.hasBox) {
        // No box: resizing scales the font proportionally, anchored on the opposite corner
        const s = old.w > 0 ? nb.w / old.w : 1
        el.setAttribute('font-size', r((num('font-size', old.fontSize)) * s))
        el.setAttribute('x', r(old.local.x + dxl + (num('x') - old.local.x) * s))
        el.setAttribute('y', r(old.local.y + dyl + (num('y') - old.local.y) * s))
      } else {
        el.setAttribute('x', r(num('x') + dxl)); el.setAttribute('y', r(num('y') + dyl))
        if (el.hasAttribute('width') || tag !== 'text') { el.setAttribute('width', r(wl)); el.setAttribute('height', r(hl)) }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing tools
  // ---------------------------------------------------------------------------

  let drawing = null // { x0, y0, node }

  function pointer() {
    const p = stage.getRelativePointerPosition()   // in card units, whatever the zoom
    return { x: snapTo(p.x), y: snapTo(p.y) }
  }

  function onStageDown(e) {
    if (tool === 'select') { if (e.target === stage || e.target === bgNode) startMarquee(!!e.evt?.shiftKey); return }
    const p = pointer()
    if (tool === 'rect' || tool === 'ellipse') {
      const node = new Konva.Rect({ x: p.x, y: p.y, width: 1, height: 1, stroke: '#0e7ded', dash: [4, 3], strokeScaleEnabled: false })
      uiLayer.add(node)
      drawing = { x0: p.x, y0: p.y, node }
    } else insertElement(tool, { x: p.x, y: p.y, w: 0, h: 0 })
  }

  function onStageMove() {
    if (marquee) { moveMarquee(); return }
    if (!drawing) return
    const p = pointer()
    drawing.node.setAttrs({ x: Math.min(p.x, drawing.x0), y: Math.min(p.y, drawing.y0), width: Math.abs(p.x - drawing.x0), height: Math.abs(p.y - drawing.y0) })
    uiLayer.batchDraw()
  }

  function onStageUp() {
    if (marquee) { finishMarquee(); return }
    if (!drawing) return
    const { node } = drawing
    const box = { x: node.x(), y: node.y(), w: node.width(), h: node.height() }
    node.destroy(); drawing = null
    if (box.w < 4 || box.h < 4) { box.w = 100; box.h = 80 } // plain click: default size
    insertElement(tool, box)
  }

  function insertElement(kind, b) {
    const doc = parse(); if (!doc) return
    const root = doc.documentElement
    const used = new Set([...doc.querySelectorAll('[data-spadewick-id]')].map(e => e.getAttribute('data-spadewick-id')))
    const base = kind
    let n = 1; while (used.has(`${base}_${n}`)) n++
    const id = `${base}_${n}`
    const mk = (tag, attrs) => { const el = doc.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el }
    const imageField = $fields.find(f => f.type === 'image_ref')
    const textField = $fields.find(f => ['text', 'formula'].includes(f.type))
    let el
    if (kind === 'text') {
      el = mk('text', { x: b.x, y: b.y + 24, 'font-size': 24, fill: '#ffffff', 'data-spadewick-id': id })
      el.textContent = textField ? `{{${textField.slug}}}` : 'Text'
    } else if (kind === 'image') {
      el = mk('image', { x: b.x, y: b.y, width: 100, height: 100, href: imageField ? `{{${imageField.slug}}}` : '', preserveAspectRatio: 'xMidYMid slice', 'data-spadewick-id': id })
    } else if (kind === 'rect') {
      el = mk('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: '#444444', 'data-spadewick-id': id })
    } else {
      el = mk('ellipse', { cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2, fill: '#444444', 'data-spadewick-id': id })
    }
    root.appendChild(el)
    selectedId = id
    selectedIds = [id]
    tool = 'select'
    if (kind === 'text' && !textField) pendingEdit = id      // nothing bound to it: the person types the words
    // An image with no field to show has nothing to display yet: go straight to choosing (or importing) one
    if (kind === 'image' && !imageField) { assetPickerOpen = true; loadAssetNames() }
    commit(doc)
  }

  function deleteSelected() {
    if (!selectedIds.length) return
    const ids = [...selectedIds]
    selectedIds = []; selectedId = null
    mutate(doc => removeElements(doc, ids))
  }

  // ---- copy, paste, duplicate, group (A80) ----

  function copySelection() {
    const doc = parse()
    if (!doc || !selectedIds.length) return false
    holdClip(serializeElements(doc, selectedIds))
    pasteCount = 0
    return true
  }

  function cutSelection() { if (copySelection()) deleteSelected() }

  function pasteClip() {
    const text = heldClip()
    const doc = text && parse()
    if (!doc) return false
    pasteCount++
    const ids = pasteElements(doc, text, { dx: 12 * pasteCount, dy: 12 * pasteCount })
    if (!ids?.length) return false
    selectedIds = ids; selectedId = ids[ids.length - 1]
    commit(doc)
    return true
  }

  function duplicateSelection() {
    const doc = parse()
    if (!doc || !selectedIds.length) return
    const ids = cloneElements(doc, selectedIds, { dx: 12, dy: 12 })
    if (!ids.length) return
    selectedIds = ids; selectedId = ids[ids.length - 1]
    commit(doc)
  }

  function groupSelection() {
    const doc = parse()
    if (!doc) return
    const r = groupElements(doc, selectedIds)
    if (r.error) { toast(tr(r.error === 'differentParents' ? 'canvasEditor.groupDifferentParents' : 'canvasEditor.groupNeedsTwo'), 'info', 3500); return }
    selectedIds = [r.id]; selectedId = r.id
    commit(doc)
  }

  function ungroupSelection() {
    const doc = parse()
    if (!doc) return
    const freed = []
    let refused = null, groups = 0
    for (const id of selectedIds) {
      const el = doc.querySelector(`[data-spadewick-id="${CSS.escape(id)}"]`)
      if (!el || el.localName !== 'g') continue
      groups++
      const r = ungroupElement(doc, id)
      if (r.error) refused = r.attribute; else freed.push(...r.ids)
    }
    if (refused) toast(tr('canvasEditor.ungroupEffects', { attribute: refused }), 'info', 4500)
    else if (!groups) toast(tr('canvasEditor.ungroupNone'), 'info', 2500)
    if (!freed.length) return
    selectedIds = freed; selectedId = freed[freed.length - 1]
    commit(doc)
  }

  // ---- align and distribute (A80) ----
  // One element is aligned to the card; several to the block that holds them. Locked elements stay where they are.
  const alignable = () => { const doc = parse(); return doc ? topLevel(doc, selectedIds.filter(id => !lockedIds.has(id) && boxes[id])) : [] }
  $: alignCount = selectedIds.filter(id => !lockedIds.has(id) && boxes[id]).length

  function applyOffsets(offsets) {
    const list = [...offsets].map(([id, o]) => ({ id, old: boxes[id], nb: { ...boxes[id], x: boxes[id].x + o.dx, y: boxes[id].y + o.dy } }))
    if (list.length) writeGeometries(list)
  }

  function alignSelection(mode) {
    const ids = alignable()
    if (!ids.length) return
    const list = ids.map(id => ({ id, ...boxes[id] }))
    applyOffsets(alignOffsets(list, mode, ids.length === 1 ? { x: 0, y: 0, w: docSize.w, h: docSize.h } : null))
  }

  function distributeSelection(axis) {
    const ids = alignable()
    if (ids.length < 3) return
    applyOffsets(distributeOffsets(ids.map(id => ({ id, ...boxes[id] })), axis))
  }

  /** Move everything selected by (dx, dy), as one edit. */
  function nudge(dx, dy) {
    const doc = parse()
    if (!doc) return
    const list = topLevel(doc, selectedIds.filter(id => !lockedIds.has(id))).map(id => boxes[id] && { id, old: boxes[id], nb: { ...boxes[id], x: boxes[id].x + dx, y: boxes[id].y + dy } }).filter(Boolean)
    if (list.length) writeGeometries(list)
  }

  // ---------------------------------------------------------------------------
  // Properties panel
  // ---------------------------------------------------------------------------

  function refreshProps() {
    if (!selectedId) { props = null; return }
    const doc = parse(); const el = doc && elOf(doc, selectedId)
    const b = boxes[selectedId]
    if (!el || !b) { props = null; return }
    const tag = el.tagName.toLowerCase()
    const fixedImage = tag === 'image' ? (ASSET_TOKEN.exec(el.getAttribute('href') || el.getAttribute('xlink:href') || '') || [])[1] ?? '' : ''
    const bound = (/\{\{\s*([\w]+)\s*\}\}/.exec(tag === 'image' ? (el.getAttribute('href') || el.getAttribute('xlink:href') || '') : tag === 'text' ? el.textContent : el.getAttribute('fill') || '') || [])[1] ?? ''
    props = {
      tag, x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h),
      field: fixedImage ? '__asset' : (el.getAttribute('data-spadewick-field') || bound),
      assetId: fixedImage,
      literal: tag === 'text' && !el.children.length ? el.textContent : null,   // the wording of a text with no field and no inner elements, edited in the panel
      fontFamily: el.getAttribute('font-family') || '',
      fontSize: el.getAttribute('font-size') || String(Math.round(b.fontSize * 10) / 10),
      fontWeight: el.getAttribute('font-weight') || '',
      fontStyle: el.getAttribute('font-style') || '',
      anchor: el.getAttribute('text-anchor') || 'start',
      fit: el.getAttribute('data-spadewick-text-fit') || (el.getAttribute('data-spadewick-field') ? 'wrap' : ''),
      lineHeight: el.getAttribute('data-spadewick-line-height') || '',
      rich: el.getAttribute('data-spadewick-rich') === 'true',
      textAlign: el.getAttribute('data-spadewick-text-align') || '',
      valign: el.getAttribute('data-spadewick-valign') || '',
      indent: el.getAttribute('data-spadewick-indent') || '',
      paragraphSpacing: el.getAttribute('data-spadewick-paragraph-spacing') || '',
      bullets: el.getAttribute('data-spadewick-bullets') === 'true',
      bullet: el.getAttribute('data-spadewick-bullet') || '',
      transform: el.getAttribute('data-spadewick-text-transform') || '',
      balance: el.getAttribute('data-spadewick-balance') === 'true',
      avoidOrphans: el.getAttribute('data-spadewick-avoid-orphans') === 'true',
      outline: el.getAttribute('data-spadewick-outline') || '',
      shadow: el.getAttribute('data-spadewick-shadow') || '',
      step: el.getAttribute('data-spadewick-text-step') || '',
      tighten: el.getAttribute('data-spadewick-tighten') || '',
      iconsFixed: el.getAttribute('data-spadewick-icon-scale') === 'fixed',
      maxLines: el.getAttribute('data-spadewick-text-max-lines') || '',
      keywordsOff: el.getAttribute('data-spadewick-keywords') === 'off',
      tracking: /^-?[\d.]+em$/.test(el.getAttribute('letter-spacing') || '') ? String(Math.round(parseFloat(el.getAttribute('letter-spacing')) * 1000)) : '',
      wordSpacing: (el.getAttribute('word-spacing') || '').replace(/em$/, ''),
      rotation: Number((/rotate\(\s*(-?[\d.]+)/.exec(el.getAttribute('transform') || '') || [])[1] ?? 0),
      fill: el.getAttribute('fill') || '',
      stroke: el.getAttribute('stroke') || '',
      opacity: el.getAttribute('opacity') ?? '1',
      strokeWidth: el.getAttribute('stroke-width') ?? '',
      dash: dashKind(el),
      cap: el.getAttribute('stroke-linecap') || '',
      join: el.getAttribute('stroke-linejoin') || '',
      gradient: readGradient(doc, el),
      effects: readEffects(doc, el),
      blend: getStyleProp(el, 'mix-blend-mode'),
      swatches: documentColours(doc),
      showIf: el.getAttribute('data-spadewick-show-if') || '',
      hideIf: el.getAttribute('data-spadewick-hide-if') || '',
      component: comps.isInstance(el) ? { ...comps.componentInfo(el), parts: comps.partsOf(el) } : null,
      partOf: comps.instanceAbove(el)
    }
    if (fixedImage && !(fixedImage in assetNames)) loadAssetNames()
  }

  const round = v => Math.round(v * 100) / 100

  /** How the outline is drawn: a solid line, dashes, or dots (a zero-length dash with round ends). */
  function dashKind(el) {
    const d = (el.getAttribute('stroke-dasharray') || '').trim()
    if (!d || d === 'none') return 'solid'
    return /^0[\s,]+[\d.]+$/.test(d) ? 'dotted' : 'dashed'
  }

  // The appearance controls act on everything that is selected, each element with its own gradient and effect definitions
  /** What a colour change reaches: the element and, for a group, every shape inside it that sets that colour itself (the rest inherit it from the group). */
  const PAINTED = new Set(['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'text', 'tspan'])
  const CASCADES = new Set(['fill', 'stroke', 'stroke-width'])
  function paintTargets(el, name) {
    const out = [el]
    if (el.localName === 'g' && CASCADES.has(name)) for (const d of descendants(el)) if (PAINTED.has(d.localName) && d.hasAttribute(name) && d.getAttribute(name) !== 'none') out.push(d)
    return out
  }
  function onFill(e) {
    const f = e.detail
    mutate(doc => {
      for (const id of selectedIds.length ? selectedIds : [selectedId]) {
        const el = elOf(doc, id); if (!el) continue
        if (f.mode === 'gradient') writeGradient(doc, el, f.gradient)
        else {
          writeGradient(doc, el, null)
          for (const t of paintTargets(el, 'fill')) { if (f.color) t.setAttribute('fill', f.color); else if (t === el) t.removeAttribute('fill') }
        }
      }
    })
  }
  function onEffects(e) {
    mutate(doc => { for (const id of selectedIds.length ? selectedIds : [selectedId]) { const el = elOf(doc, id); if (el) writeEffects(doc, el, e.detail) } })
  }
  function onBlend(e) {
    mutate(doc => { for (const id of selectedIds.length ? selectedIds : [selectedId]) { const el = elOf(doc, id); if (el) setStyleProp(el, 'mix-blend-mode', e.detail === 'normal' ? '' : e.detail) } })
  }

  function setAttr(name, value) { setAttrs({ [name]: value }) }

  /** Set (or, for an empty value, remove) several attributes in one step of the editor's history. */
  function setAttrs(map) {
    mutate(doc => {
      for (const id of selectedIds.length ? selectedIds : [selectedId]) {
        const el = elOf(doc, id); if (!el) continue
        for (const [name, value] of Object.entries(map)) {
          for (const t of paintTargets(el, name)) { if (value === '' || value == null) { if (t === el) t.removeAttribute(name) } else t.setAttribute(name, value) }
        }
      }
    })
  }
  const optional = (name, on) => ({ [name]: on ? 'true' : '' })

  function setGeometry(key, value) {
    const v = parseFloat(value); if (Number.isNaN(v) || !selectedId) return
    const old = boxes[selectedId]
    const nb = { x: old.x, y: old.y, w: old.w, h: old.h }
    nb[key] = key === 'w' || key === 'h' ? Math.max(4, v) : v
    if ((lockAspect || (old.tag === 'text' && !old.hasBox)) && (key === 'w' || key === 'h')) {
      const ratio = old.w / old.h
      if (key === 'w') nb.h = nb.w / ratio; else nb.w = nb.h * ratio
    }
    writeGeometry(selectedId, old, nb)
  }

  // PRD §7.1: an image element can show a fixed library image, the same on every card
  const ASSET_TOKEN = /\{\{\s*@asset\.([^}\s]+)\s*\}\}/
  let assetPickerOpen = false
  let assetNames = {}
  let namesLoaded = false
  async function loadAssetNames() { assetNames = Object.fromEntries((await window.spadewick.assets.list({})).map(a => [a.id, a.original_name])); namesLoaded = true }

  function onBindingChange(e) {
    const value = e.target.value
    if (value === '__asset') { e.target.value = props.field; assetPickerOpen = true; loadAssetNames(); return }
    setField(value)
  }

  /** A block drawn as a rectangle (an art area) becomes an image layer on top of it, so a library image can be put in it. */
  function makeImage() {
    mutate(doc => {
      const el = elOf(doc, selectedId); if (!el || el.localName !== 'rect') return
      const img = doc.createElementNS(NS, 'image')
      for (const n of ['x', 'y', 'width', 'height']) img.setAttribute(n, el.getAttribute(n) || '0')
      img.setAttribute('href', '')
      img.setAttribute('preserveAspectRatio', 'xMidYMid slice')
      img.setAttribute('data-spadewick-id', selectedId)
      el.removeAttribute('data-spadewick-id')
      el.parentNode.insertBefore(img, el.nextSibling)
    })
    assetPickerOpen = true; loadAssetNames()
  }

  function setFixedImage(assetId) {
    assetPickerOpen = false
    mutate(doc => { elOf(doc, selectedId)?.setAttribute('href', assetId ? `{{@asset.${assetId}}}` : '') })
  }

  // ---- components (PRD §7.10): parts kept in the library, copied into the template, kept up to date from it ----
  let componentsOpen = false
  let libInfo = null, libFor = null          // what the library has of the selected instance's component: { version }, or 'missing'
  async function loadLibInfo(id) {
    libFor = id; libInfo = null
    try { const c = await window.spadewick.components.get(id); if (libFor === id) libInfo = c ? { version: c.version } : 'missing' } catch { if (libFor === id) libInfo = 'missing' }
  }
  $: if (props?.component && libFor !== props.component.id) loadLibInfo(props.component.id)
  $: if (!props?.component && libFor) { libFor = null; libInfo = null }
  $: libStatus = !props?.component || !libInfo ? 'checking' : libInfo === 'missing' ? 'missing' : libInfo.version > props.component.version ? 'update' : 'same'

  const unionBox = list => {
    const x = Math.min(...list.map(b => b.x)), y = Math.min(...list.map(b => b.y))
    return { x: round(x), y: round(y), w: round(Math.max(...list.map(b => b.x + b.w)) - x), h: round(Math.max(...list.map(b => b.y + b.h)) - y) }
  }

  async function insertComponent({ detail }) {
    componentsOpen = false
    let c = null
    try { c = await window.spadewick.components.get(detail.id) } catch { /* shown below */ }
    if (!c) { toast(tr('canvasEditor.componentGone'), 'error', 4000); return }
    const doc = parse(); if (!doc) return
    const id = comps.instantiate(doc, c)
    selectedIds = [id]; selectedId = id
    commit(doc)
    const lacking = c.fields.filter(f => f !== 'display_name' && !$fields.some(x => x.slug === f))
    if (lacking.length) toast(tr('canvasEditor.componentFieldsMissing', { fields: lacking.join(', ') }), 'info', 6000)
  }

  /** The selection becomes a component of the library, and in this template an instance of it. */
  async function makeComponent() {
    const doc = parse(); if (!doc) return
    const ids = topLevel(doc, selectedIds.filter(id => boxes[id]))
    if (!ids.length) return
    const els = ids.map(id => elOf(doc, id))
    if (els.some(e => !e || comps.isInstance(e))) { toast(tr('canvasEditor.componentAlready'), 'info', 3500); return }
    const name = await askText(tr('canvasEditor.componentName'), '')
    if (!name?.trim()) return
    const packed = comps.packElements(doc, els)
    try {
      const saved = await window.spadewick.components.save({ name: name.trim(), xml: packed.xml, defs: packed.defs, bounds: unionBox(ids.map(id => boxes[id])), refWidth: docSize.w })
      const doc2 = parse(); if (!doc2) return
      const gid = comps.markAsInstance(doc2, ids, { id: saved.id, name: name.trim(), version: saved.version })
      if (!gid) return
      selectedIds = [gid]; selectedId = gid
      commit(doc2)
      toast(tr('canvasEditor.componentSaved', { name: name.trim() }), 'info', 3500)
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  async function updateComponent(keepOverrides = true) {
    const info = props?.component; if (!info) return
    let c = null
    try { c = await window.spadewick.components.get(info.id) } catch { /* shown below */ }
    if (!c) { toast(tr('canvasEditor.componentGone'), 'error', 4000); return }
    mutate(doc => comps.updateInstance(doc, selectedId, c, { keepOverrides }))
    libFor = null
  }

  /** What this instance holds becomes the library's next version of the component (its changed colours and words are part of it). */
  async function pushComponent() {
    const doc = parse(); const g = doc && elOf(doc, selectedId)
    if (!g || !comps.isInstance(g) || !boxes[selectedId]) return
    const info = comps.componentInfo(g)
    const packed = comps.packInstance(doc, selectedId)
    let existing = null
    try { existing = await window.spadewick.components.get(info.id) } catch { /* it is made again below */ }
    try {
      const saved = await window.spadewick.components.save({
        id: existing ? info.id : undefined, name: info.name, xml: packed.xml, defs: packed.defs,
        bounds: comps.localBounds(g, boxes[selectedId]), refWidth: existing?.refWidth ?? docSize.w
      })
      mutate(d => { const x = elOf(d, selectedId); x.setAttribute(comps.COMPONENT, saved.id); x.setAttribute(comps.VERSION, String(saved.version)); x.removeAttribute(comps.OVERRIDES) })
      libFor = null
      toast(tr('canvasEditor.componentPushed', { name: info.name, version: saved.version }), 'info', 3500)
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  const detachComponent = () => { mutate(doc => comps.detach(doc, selectedId)); libFor = null }
  const setPart = (part, key, value) => mutate(doc => comps.setOverride(doc, selectedId, part, key, value))

  // ---- text styles (A80): applied as a copy, so the template needs nothing from the project ----
  let textStyles = []
  async function loadTextStyles() { try { textStyles = await window.spadewick.textStyles.list() } catch { textStyles = [] } }

  function applyTextStyle(e) {
    const id = e.currentTarget.value
    e.currentTarget.value = ''
    const style = textStyles.find(t => t.id === id)
    if (style) setAttrs(styleAttrs(style.props))
  }

  async function saveTextStyle() {
    const doc = parse(); const el = doc && elOf(doc, selectedId)
    if (!el) return
    const name = await askText(tr('canvasEditor.textStyleName'))
    if (!name?.trim()) return
    try {
      const made = await window.spadewick.textStyles.create({ name: name.trim(), props: styleFromAttrs(n => el.getAttribute(n) || '') })
      toast(tr('canvasEditor.textStyleSaved', { name: made.name }), 'info', 3000)
      await loadTextStyles()
    } catch (err) { toast(err.message, 'error', 5000) }
  }
  let stylesAsked = false
  $: if (props?.tag === 'text' && !stylesAsked) { stylesAsked = true; loadTextStyles() }       // once: a project with no styles must not ask again and again

  // ---- typing on the canvas (A80) ----
  // A text that shows no field has words of its own: double-click it, or press Enter on it, and type where it sits.

  /** Is this text typed by hand (no field, no token, no inner elements)? */
  function typedText(id) {
    const doc = parse(); const el = doc && elOf(doc, id)
    if (!el || el.localName !== 'text' || el.children.length || el.getAttribute('data-spadewick-field')) return null
    return /\{\{[^}]*\}\}/.test(el.textContent) ? null : el
  }

  function startEdit(id) {
    if (lockedIds.has(id) || !boxes[id]) return false
    const el = typedText(id)
    if (!el) {
      const doc = parse(); const t = doc && elOf(doc, id)
      if (t?.localName === 'text') toast(tr('canvasEditor.boundTextHint'), 'info', 5000)
      return false
    }
    if (selectedId !== id || selectedIds.length !== 1) select(id)
    editing = { id, value: el.textContent, original: el.textContent }
    return true
  }

  function finishEdit(keep = true) {
    const e = editing
    if (!e) return
    editing = null
    if (keep && e.value !== e.original) { selectedIds = [e.id]; selectedId = e.id; setLiteral(e.value) }
  }

  const focusAndSelect = node => { node.focus(); node.select() }

  function onEditKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finishEdit(true) }
    else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); finishEdit(true) }
    ev.stopPropagation()                                       // none of these keys is a shortcut of the canvas while typing
  }

  /** Where the box goes and how the words look in it, in screen pixels: the text's own size at the current zoom. */
  function editStyle(e, z) {
    const b = boxes[e.id]
    if (!b || !props) return ''
    const size = Math.max(8, (parseFloat(props.fontSize) || b.fontSize) * z)
    const fill = /^#[0-9a-f]{6}$/i.test(props.fill) ? props.fill : '#000000'
    const lum = (0.299 * parseInt(fill.slice(1, 3), 16) + 0.587 * parseInt(fill.slice(3, 5), 16) + 0.114 * parseInt(fill.slice(5, 7), 16)) / 255
    const align = props.anchor === 'middle' ? 'center' : props.anchor === 'end' ? 'right' : 'left'
    return [
      `left:${Math.round(b.x * z - 4)}px`, `top:${Math.round(b.y * z - 2)}px`,
      `min-width:${Math.max(120, Math.round(b.w * z + 16))}px`, `min-height:${Math.round(size * 1.3)}px`,
      `font-size:${size}px`, `line-height:1.2`, `color:${fill}`, `text-align:${align}`,
      `font-weight:${props.fontWeight || 'normal'}`, `font-style:${props.fontStyle || 'normal'}`,
      props.fontFamily ? `font-family:${props.fontFamily}, sans-serif` : '',
      `background:${lum > 0.6 ? 'rgba(20,20,30,.78)' : 'rgba(255,255,255,.9)'}`
    ].filter(Boolean).join(';')
  }
  $: editCss = editing ? editStyle(editing, zoom) : ''

  /** Freetext: the wording of an unbound text element, typed in the properties panel. */
  function setLiteral(value) {
    mutate(doc => {
      const el = elOf(doc, selectedId)
      if (el && el.tagName.toLowerCase() === 'text' && !el.children.length) el.textContent = value
    })
    refreshProps()
  }

  function setField(slug) {
    mutate(doc => {
      const el = elOf(doc, selectedId); if (!el) return
      const tag = el.tagName.toLowerCase()
      const token = slug ? `{{${slug}}}` : ''
      if (tag === 'text') {
        el.textContent = token || 'Text'
        // PRD §7.4: dynamic text only applies when a fit mode is chosen
        if (slug && el.getAttribute('data-spadewick-text-fit')) el.setAttribute('data-spadewick-field', slug)
        else el.removeAttribute('data-spadewick-field')
      } else if (tag === 'image') {
        el.setAttribute('href', token)
      } else if (token) el.setAttribute('fill', token)
    })
  }

  const ASCENT = 0.85 // must match dynamicText.js: first baseline = box top + ascent × font size

  function setFit(mode) {
    mutate(doc => {
      const el = elOf(doc, selectedId); if (!el) return
      const b = boxes[selectedId]
      const size = parseFloat(el.getAttribute('font-size')) || b.fontSize
      const slug = (/\{\{\s*(\w+)\s*\}\}/.exec(el.textContent) || [])[1] || el.getAttribute('data-spadewick-field')
      const had = el.hasAttribute('data-spadewick-text-fit') && el.hasAttribute('width') // already laid out in a box (y = top edge)
      for (const a of ['data-spadewick-text-max-size', 'data-spadewick-text-min-size']) el.removeAttribute(a)

      if (!mode) {
        // Back to a plain single-line label: drop the box and return y to the baseline
        if (had) el.setAttribute('y', String(Math.round((parseFloat(el.getAttribute('y')) + size * ASCENT) * 100) / 100))
        for (const a of ['data-spadewick-text-fit', 'data-spadewick-field', 'data-spadewick-line-height', 'width', 'height']) el.removeAttribute(a)
        return
      }
      el.setAttribute('data-spadewick-text-fit', mode)
      if (slug) el.setAttribute('data-spadewick-field', slug)
      if (mode === 'shrink') { el.setAttribute('data-spadewick-text-max-size', String(size)); el.setAttribute('data-spadewick-text-min-size', '8') }
      if (!had) {
        // Wrapping needs a box. y becomes the box's top edge, so keep the text where it was drawn.
        el.setAttribute('y', String(Math.round((parseFloat(el.getAttribute('y')) - size * ASCENT) * 100) / 100))
        if (!el.hasAttribute('width')) { el.setAttribute('width', '180'); el.setAttribute('height', '60') }
      }
    })
  }

  function setRotation(angle) {
    const a = Number(angle); if (Number.isNaN(a) || !selectedId) return
    const b = boxes[selectedId]
    mutate(doc => {
      const el = elOf(doc, selectedId); if (!el) return
      let t = (el.getAttribute('transform') || '').replace(/rotate\([^)]*\)/g, '').trim()
      if (a % 360 !== 0) t = `${t} rotate(${a} ${Math.round((b.local.x + b.local.w / 2) * 100) / 100} ${Math.round((b.local.y + b.local.h / 2) * 100) / 100})`.trim()
      if (t) el.setAttribute('transform', t); else el.removeAttribute('transform')
    })
  }

  /** Reorder an element among its siblings from the layers panel (PRD §8.7.2): one edit, so one undo step. */
  function moveLayer({ id, op, target, side }) {
    const doc = parse()
    const el = doc && elOf(doc, id)
    if (!el?.parentNode) return
    const parent = el.parentNode
    const idOf = c => c.getAttribute('data-spadewick-id')
    const sibs = [...parent.children].filter(c => c.hasAttribute('data-spadewick-id'))
    const ids = sibs.map(idOf)
    const next = op ? reorder(ids, id, op) : moveRelative(ids, id, target, side)
    if (sameOrder(ids, next)) return
    const i = next.indexOf(id)
    const nodeOf = x => sibs.find(c => idOf(c) === x)
    // Elements without an id keep their place: only move next to a sibling that is part of the list
    if (i < next.length - 1) parent.insertBefore(el, nodeOf(next[i + 1]))
    else parent.insertBefore(el, nodeOf(next[i - 1]).nextSibling)
    commit(doc)
  }

  /** Rename an element's `data-spadewick-id` (PRD §8.7.2). Nothing else refers to it, so only the attribute changes. */
  function renameLayer({ id, to }) {
    const doc = parse()
    const el = doc && elOf(doc, id)
    if (!el || !to || to === id || elOf(doc, to)) return
    el.setAttribute('data-spadewick-id', to)
    const swap = set => { if (!set.has(id)) return set; const next = new Set(set); next.delete(id); next.add(to); return next }
    hiddenIds = swap(hiddenIds)
    lockedIds = swap(lockedIds)
    if (selectedId === id) selectedId = to
    selectedIds = selectedIds.map(x => (x === id ? to : x))
    commit(doc)
  }

  function toggleIn(set, id) { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next }

  function toggleHide(id) {
    hiddenIds = toggleIn(hiddenIds, id)
    rebuildHandles()
    scheduleRender()
  }

  function toggleLock(id) {
    lockedIds = toggleIn(lockedIds, id)
    rebuildHandles()
  }

  function zOrder(action) {
    mutate(doc => {
      const els = selectedIds.map(id => elOf(doc, id)).filter(el => el?.parentNode)
      const among = el => [...el.parentNode.children]
      // in document order, so the elements keep their order among themselves
      els.sort((p, q) => (p.parentNode === q.parentNode ? among(p).indexOf(p) - among(p).indexOf(q) : 0))
      const picked = new Set(els)
      if (action === 'front') for (const el of els) el.parentNode.appendChild(el)
      else if (action === 'back') for (const el of [...els].reverse()) el.parentNode.insertBefore(el, el.parentNode.firstElementChild)
      else if (action === 'forward') for (const el of [...els].reverse()) { const nx = el.nextElementSibling; if (nx && !picked.has(nx)) el.parentNode.insertBefore(nx, el) }
      else if (action === 'backward') for (const el of els) { const pv = el.previousElementSibling; if (pv && !picked.has(pv)) el.parentNode.insertBefore(el, pv) }
    })
  }

  // ---------------------------------------------------------------------------
  // Size, grid, rulers, keyboard
  // ---------------------------------------------------------------------------

  // The canvas is always drawn at 100%: one card unit is one screen pixel
  function applySize() {
    if (!stage) return
    // the host is the card; the bed (and so the stage) reaches `pad` further on every side, and the scrolling area has room for it
    const cw = docSize.w * zoom, ch = docSize.h * zoom, p = pad * zoom
    stageHost.style.width = `${cw}px`; stageHost.style.height = `${ch}px`
    stageBed.style.left = `${-p}px`; stageBed.style.top = `${-p}px`; stageBed.style.width = `${cw + 2 * p}px`; stageBed.style.height = `${ch + 2 * p}px`
    if (frameEl) frameEl.style.padding = `${FRAME_PAD + Math.ceil(p)}px`
    stage.scale({ x: zoom, y: zoom })
    placeStage()
    stage.draw()   // now, not on the next frame: the hit areas must match the new scale before the next click
  }

  const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
  const fitZoom = () => (viewW > 0 && viewH > 0 && docSize.w > 0 ? clampZoom(Math.min((viewW - 2 * FRAME_PAD) / docSize.w, (viewH - 2 * FRAME_PAD) / docSize.h)) : 1)

  /** The first view: one pixel per card unit, or smaller when the card would not fit the window. */
  function chooseFirstView() {
    zoomReady = true
    zoom = Math.min(1, fitZoom())
    applySize()
    centreCard()
    syncView()
  }

  /** The stage covers the view and shows the part of the card that is in it: its size is the view's, its place is where the card's corner is. */
  function placeStage() {
    if (!stage || !scroller || !stageHost) return
    const a = scroller.getBoundingClientRect(), b = stageHost.getBoundingClientRect()
    const w = Math.max(10, scroller.clientWidth), h = Math.max(10, scroller.clientHeight)
    if (stage.width() !== w || stage.height() !== h) stage.size({ width: w, height: h })
    stage.position({ x: b.left - a.left, y: b.top - a.top })
    stage.batchDraw()
  }

  /** Where the card is inside the scrolling area, for the rulers. */
  function syncView() {
    if (!scroller || !stageHost) return
    scrollX = scroller.scrollLeft; scrollY = scroller.scrollTop
    const a = scroller.getBoundingClientRect(), b = stageHost.getBoundingClientRect()
    originX = b.left - a.left; originY = b.top - a.top
    placeStage()
  }

  /** Set the zoom; the point under (cx, cy), in window pixels, stays where it is (the middle of the view when none is given). */
  function setZoom(z, cx, cy) {
    const next = clampZoom(z)
    if (!scroller || !stageHost || next === zoom) return
    userView = true
    const a = scroller.getBoundingClientRect()
    if (cx == null) { cx = a.left + a.width / 2; cy = a.top + a.height / 2 }
    const r = stageHost.getBoundingClientRect()
    const px = (cx - r.left) / zoom, py = (cy - r.top) / zoom       // the card point under the pointer
    zoom = next
    applySize()
    const r2 = stageHost.getBoundingClientRect()
    scroller.scrollLeft += r2.left + px * zoom - cx
    scroller.scrollTop += r2.top + py * zoom - cy
    syncView()
    sharpen()
  }

  const zoomBy = factor => setZoom(zoom * factor)
  const zoomFit = () => { setZoom(fitZoom()); centreCard() }
  const zoomActual = () => { setZoom(1); centreCard() }
  function centreCard() {
    if (!scroller) return
    scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2
    syncView()
  }

  /** After a zoom the card picture is drawn again at the new size, once the zoom has settled. */
  function sharpen() {
    clearTimeout(sharpenTimer)
    sharpenTimer = setTimeout(() => { if (!destroyed && Math.abs(renderPx() - lastRenderPx) > lastRenderPx * 0.2) scheduleRender() }, 250)
  }
  let sharpenTimer
  onDestroy(() => clearTimeout(sharpenTimer))

  function onWheel(e) {
    userView = true
    if (!(e.ctrlKey || e.metaKey)) return          // a plain wheel scrolls; Ctrl+wheel and a trackpad pinch zoom
    e.preventDefault()
    setZoom(zoom * Math.pow(1.0018, -e.deltaY), e.clientX, e.clientY)
  }

  // Panning: space and drag, or the middle button, anywhere in the view (the shield below keeps the stage from also seeing it)
  function onPanDown(e) {
    if (!(e.button === 1 || (spaceDown && e.button === 0))) return
    userView = true
    e.preventDefault(); e.stopPropagation()
    panning = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop }
  }
  function onPanMove(e) {
    if (!panning) return
    scroller.scrollLeft = panning.left - (e.clientX - panning.x)
    scroller.scrollTop = panning.top - (e.clientY - panning.y)
  }
  function onPanUp() { panning = null }

  /** Tick marks for one ruler: a round step, at least 56 pixels apart on screen, labelled in card units. */
  function rulerTicks(scroll, view, origin, length, z) {
    if (!(view > 0) || !(z > 0)) return { major: [], minor: [], from: 0, to: 0 }
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => s * z >= 56) ?? 1000
    const sub = step >= 10 ? step / 5 : step / 2
    const first = Math.floor((0 - origin) / z / sub) * sub, last = Math.ceil((view - origin) / z / sub) * sub
    const major = [], minor = []
    for (let v = first; v <= last + 1e-6; v += sub) {
      if (v < -1e-6 || v > length + 1e-6) continue
      const at = origin + v * z
      if (at < 0 || at > view) continue
      ;(Math.abs(v / step - Math.round(v / step)) < 1e-6 ? major : minor).push({ at, v: Math.round(v * 100) / 100 })
    }
    return { major, minor, from: Math.max(0, origin), to: Math.min(view, origin + length * z) }
  }

  /**
   * The grid is drawn in two tones, a dark line with a light line beside it, so it shows on a dark card, a light
   * one and everything between. The lines every 50 units are stronger (PRD §8.3).
   */
  function drawGrid(on, size, z = 1) {
    gridLayer.destroyChildren()
    if (on) {
      // At 100% the lines are as before (10 units, stronger every 50). Zoomed out, the fine lines go first so the grid never turns to mush;
      // zoomed in, a finer step appears. Each line is a pair (dark and light) one screen pixel wide, so it shows on any card.
      const px = 1 / z
      const minor = [1, 2, 5, 10, 20, 50, 100].find(s => s * z >= 8) ?? 100
      const majorStep = Math.max(50, minor * 5)
      // one shape, four strokes (minor and major, dark and light): thousands of separate lines made zooming in slow
      gridLayer.add(new Konva.Shape({
        listening: false,
        sceneFunc: (ctx) => {
          const c = ctx._context
          const passes = [['rgba(0,0,0,.22)', false, 0.5], ['rgba(255,255,255,.3)', false, 1.5], ['rgba(0,0,0,.7)', true, 0.5], ['rgba(255,255,255,.75)', true, 1.5]]
          c.lineWidth = px
          for (const [colour, major, shift] of passes) {
            c.beginPath()
            for (let x = 0; x <= size.w; x += minor) if ((x % majorStep === 0) === major) { c.moveTo(x + shift * px, 0); c.lineTo(x + shift * px, size.h) }
            for (let y = 0; y <= size.h; y += minor) if ((y % majorStep === 0) === major) { c.moveTo(0, y + shift * px); c.lineTo(size.w, y + shift * px) }
            c.strokeStyle = colour
            c.stroke()
          }
        }
      }))
    }
    gridLayer.batchDraw()
  }

  /** What lies outside the card is dimmed, and the card's edge is drawn, so a spilling element shows where it leaves the card (it is cut off there). */
  let veil = null
  function drawVeil(size, p, z) {
    veil?.destroy()
    veil = new Konva.Group({ listening: false, name: 'veil' })
    const shade = { fill: 'rgba(16, 16, 20, 0.55)', listening: false }
    veil.add(
      new Konva.Rect({ x: -p, y: -p, width: size.w + 2 * p, height: p, ...shade }),
      new Konva.Rect({ x: -p, y: size.h, width: size.w + 2 * p, height: p, ...shade }),
      new Konva.Rect({ x: -p, y: 0, width: p, height: size.h, ...shade }),
      new Konva.Rect({ x: size.w, y: 0, width: p, height: size.h, ...shade }),
      new Konva.Rect({ x: 0, y: 0, width: size.w, height: size.h, stroke: 'rgba(255, 255, 255, 0.85)', strokeWidth: 1, strokeScaleEnabled: false, listening: false })
    )
    bgLayer.add(veil)
    bgLayer.batchDraw()
  }

  /**
   * The trim, safe and bleed lines for the card size (PRD §17.4). A canvas that includes bleed has the trim line inside it and the
   * bleed edge at its own edge; a canvas of trim size has its edge as the trim line, and the bleed lies outside it (labelled only).
   * Each line is dashed in its own colour and labelled in words, so colour is not the only cue.
   */
  function drawPrintGuides(on, size, card, bleed, mode, safe, z = 1) {
    printLayer.destroyChildren()
    if (on && card?.mmW > 0) {
      const included = mode === 'included' && bleed > 0
      const unit = size.w / (card.mmW + (included ? 2 * bleed : 0))      // template units per millimetre
      const b = included ? bleed * unit : 0
      const rect = (inset, color, label, dash) => {
        const x = inset + 0.5, y = inset + 0.5, w = size.w - 2 * inset - 1, h = size.h - 2 * inset - 1
        if (w <= 0 || h <= 0) return
        printLayer.add(new Konva.Rect({ x, y, width: w, height: h, stroke: color, strokeWidth: 1.5, strokeScaleEnabled: false, dash }))
        const tag = new Konva.Label({ x: x + 3, y: y + 3 })
        tag.add(new Konva.Tag({ fill: color }))
        tag.add(new Konva.Text({ text: label, fontSize: 10, padding: 2, fill: '#ffffff' }))
        tag.scale({ x: 1 / z, y: 1 / z })     // the label keeps its size on screen
        printLayer.add(tag)
      }
      if (included) rect(0, '#b02a37', tr('canvasEditor.guideBleed'), [2, 3])
      rect(b, '#c2255c', tr('canvasEditor.guideTrim'), [6, 4])
      rect(b + safe * unit, '#0b5cad', tr('canvasEditor.guideSafe'), [3, 3])
    }
    printLayer.batchDraw()
  }

  // a command sent before this editor was opened (the store keeps the last one) is not for it: it would run again as soon as the editor mounts
  let lastCommandN = get(canvasCommand)?.n ?? 0
  function handleCommand(c) {
    if (!c || c.n === lastCommandN) return
    lastCommandN = c.n
    if (c.cmd === 'rulers') showRulers = !showRulers
    else if (c.cmd === 'grid') showGrid = !showGrid
    else if (c.cmd === 'snap') snap = !snap
    else if (c.cmd === 'guides') toggleGuides()
    else if (c.cmd === 'zoom-in') zoomBy(1.25)
    else if (c.cmd === 'zoom-out') zoomBy(0.8)
    else if (c.cmd === 'zoom-reset') zoomActual()
    else if (c.cmd === 'zoom-fit') zoomFit()
    else if (c.cmd === 'layerize') makeLayers()
  }

  /** Every element without a layer of its own gets one (Template → Make every element a layer): one step of undo. */
  function makeLayers() {
    const doc = parse(); if (!doc) return
    const r = layerize(doc)
    if (r.added) { commit(doc); sourceChanged() }   // this runs inside a reactive statement: the measuring is asked for here, not left to the one that watches the source
    toast(r.added ? tr('canvasEditor.layersMade', { n: r.added }) : tr('canvasEditor.layersAlready'), 'info', 3500)
    if (r.limited) toast(tr('canvasEditor.layersLimited'), 'info', 5000)
  }

  $: tool, uiLayer && uiLayer.find('.handle').forEach(n => n.draggable(tool === 'select' && !lockedIds.has(n.id())))
  $: lockAspect, selectedId && boxes[selectedId] && transformer && transformer.keepRatio(lockAspect || boxes[selectedId].tag === 'circle')

  function ticks(length) {
    const step = 50
    const out = []
    for (let v = 0; v <= length; v += step) out.push(v)
    return out
  }

  function onKey(e) {
    if (e.key === 'Shift') shiftHeld = true
    // Escape during a drag cancels it: nothing is written to the SVG
    if (e.key === 'Escape' && dragging) { e.preventDefault(); cancelled = true; activeNode?.stopDrag(); transformer?.stopTransform?.(); return }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
    if (e.ctrlKey || e.metaKey) {
      // Zoom: Ctrl + / Ctrl - / Ctrl 0 (fit) / Ctrl 1 (100%)
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomBy(1.25) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(0.8) }
      else if (e.key === '0') { e.preventDefault(); zoomFit() }
      else if (e.key === '1') { e.preventDefault(); zoomActual() }
      else {
        const k = e.key.toLowerCase()
        if (k === 'a') { e.preventDefault(); selectAll() }
        else if (k === 'c') { if (copySelection()) e.preventDefault() }
        else if (k === 'x') { if (selectedIds.length) { e.preventDefault(); cutSelection() } }
        else if (k === 'v') { if (pasteClip()) e.preventDefault() }
        else if (k === 'd') { e.preventDefault(); duplicateSelection() }
        else if (k === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelection(); else groupSelection() }
      }
      return
    }
    if (e.key === 'Enter' && selectedId && !multi && (e.target === document.body || scroller?.contains(e.target))) { if (startEdit(selectedId)) e.preventDefault(); return }
    if (e.code === 'Space') { if (pointerOver || e.target === document.body || scroller?.contains(e.target)) { e.preventDefault(); if (!e.repeat) spaceDown = true } return }
    if (e.altKey) return
    const key = e.key.toLowerCase()
    if (key === 'v') tool = 'select'
    else if (key === 't') tool = 'text'
    else if (key === 'i') tool = 'image'
    else if (key === 'r') tool = 'rect'
    else if (key === 'e') tool = 'ellipse'
    else if (e.key === 'Escape' && selectedIds.length && !dragging) deselect()
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length) { e.preventDefault(); e.stopPropagation(); deleteSelected() }
    else if (selectedIds.length && e.key.startsWith('Arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      nudge(e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0, e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0)
    }
  }

  function onKeyUp(e) { if (e.code === 'Space') spaceDown = false; if (e.key === 'Shift') shiftHeld = false }

  const TOOLS = [
    { id: 'select', label: tr('canvasEditor.toolSelect') }, { id: 'text', label: tr('canvasEditor.toolText') },
    { id: 'image', label: tr('canvasEditor.toolImage') }, { id: 'rect', label: tr('canvasEditor.toolRectangle') }, { id: 'ellipse', label: tr('canvasEditor.toolEllipse') }
  ]

  // The zoom control: the usual steps, and the current value when it is none of them
  $: zoomValue = String(Math.round(zoom * 100) / 100)
  $: zoomOptions = [...new Set([...ZOOM_PRESETS, Number(zoomValue)])].sort((a, b) => a - b)
  function onZoomPick(e) {
    const v = e.currentTarget.value
    if (v === 'fit') zoomFit(); else setZoom(Number(v))
    e.currentTarget.blur()      // the keys (Space to pan, T, R...) belong to the canvas again
  }
</script>

<svelte:window on:keydown={onKey} on:keyup={onKeyUp} on:mousemove={onPanMove} on:mouseup={() => { onPanUp(); finishMarquee() }} on:blur={() => { spaceDown = false; panning = null }} on:resize={syncView} />

<div class="canvas-editor">
  <div class="toolbar" role="toolbar" aria-label="{tr('canvasEditor.canvasTools')}">
    <div class="group tools">
      {#each TOOLS as t}
        <button class="tool" class:active={tool === t.id} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} on:click={() => tool = t.id}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS[t.id]}</svg>
        </button>
      {/each}
    </div>
    <span class="sep" />
    <div class="group" role="group" aria-label={tr('canvasEditor.componentsGroup')}>
      <button class="tool" title={tr('canvasEditor.componentsTitle')} aria-label={tr('canvasEditor.componentsTitle')} on:click={() => (componentsOpen = true)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS.component}</svg>
      </button>
    </div>
    <span class="sep" />
    <div class="group aligners" role="group" aria-label={tr('canvasEditor.alignGroup')}>
      {#each [['left', 'alignLeft'], ['hcenter', 'alignCenter'], ['right', 'alignRight'], ['top', 'alignTop'], ['vcenter', 'alignMiddle'], ['bottom', 'alignBottom']] as [mode, key]}
        <button class="tool" disabled={alignCount < 1} title={tr(`canvasEditor.${key}`)} aria-label={tr(`canvasEditor.${key}`)} on:click={() => alignSelection(mode)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ALIGN_ICONS[mode]}</svg>
        </button>
      {/each}
      {#each [['x', 'distX', 'distributeX'], ['y', 'distY', 'distributeY']] as [axis, icon, key]}
        <button class="tool" disabled={alignCount < 3} title={tr(`canvasEditor.${key}`)} aria-label={tr(`canvasEditor.${key}`)} on:click={() => distributeSelection(axis)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ALIGN_ICONS[icon]}</svg>
        </button>
      {/each}
    </div>
    <span class="sep" />
    <div class="group view-toggles" role="group" aria-label={tr('canvasEditor.viewOptions')}>
      <button class="chip" class:active={showGrid} aria-pressed={showGrid} on:click={() => showGrid = !showGrid}>{tr('canvasEditor.grid')}</button>
      <button class="chip" class:active={showPrintGuides} aria-pressed={showPrintGuides} title="{tr('canvasEditor.printGuidesTitle')}" on:click={async () => { if (!showPrintGuides) await loadSafe(); showPrintGuides = !showPrintGuides }}>{tr('canvasEditor.printGuides')}</button>
      <button class="chip" class:active={snap} aria-pressed={snap} on:click={() => snap = !snap}>{tr('canvasEditor.snap')}</button>
      <button class="chip" class:active={smartGuides} aria-pressed={smartGuides} title="{tr('canvasEditor.guidesTitle')}" on:click={toggleGuides}>{tr('canvasEditor.guides')}</button>
      <button class="chip" class:active={showRulers} aria-pressed={showRulers} on:click={() => showRulers = !showRulers}>{tr('canvasEditor.rulers')}</button>
    </div>
    <span class="spacer" />
    {#if !lockCard}
    <label class="picker">{tr('canvasEditor.previewCard')}
      <select bind:value={cardId} disabled={!hasCards}>
        {#each $cards as c (c.id)}<option value={c.id}>{c.display_name || c.card_code || tr('cardDataEditor.unnamedCard')}</option>{/each}
      </select>
    </label>
    {/if}
  </div>

  {#if parseError}<div class="banner err">{parseError}</div>{/if}
  {#if aspectMismatch}<div class="banner warn">{tr('canvasEditor.thisTemplateIsButThe', { w: docSize.w, h: docSize.h, mmW: setSize.mmW, mmH: setSize.mmH })}</div>{/if}
  {#if renderError}<div class="banner warn">{tr('canvasEditor.previewUsesTheRawTemplate', { error: renderError })}</div>{:else if !hasCards}<div class="banner warn">{tr('canvasEditor.addACardToThis')}</div>{/if}

  <div class="work">
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="viewport" class:rulers={showRulers} on:mouseenter={() => pointerOver = true} on:mouseleave={() => pointerOver = false}>
      {#if showRulers && rulers}
        <div class="corner" aria-hidden="true"></div>
        <div class="ruler h" aria-hidden="true">
          <span class="extent" style="left:{rulers.h.from}px; width:{Math.max(0, rulers.h.to - rulers.h.from)}px"></span>
          {#each rulers.h.minor as t}<span class="tick minor" style="left:{t.at}px"></span>{/each}
          {#each rulers.h.major as t}<span class="tick" style="left:{t.at}px"><i>{t.v}</i></span>{/each}
        </div>
        <div class="ruler v" aria-hidden="true">
          <span class="extent" style="top:{rulers.v.from}px; height:{Math.max(0, rulers.v.to - rulers.v.from)}px"></span>
          {#each rulers.v.minor as t}<span class="tick minor" style="top:{t.at}px"></span>{/each}
          {#each rulers.v.major as t}<span class="tick" style="top:{t.at}px"><i>{t.v}</i></span>{/each}
        </div>
      {/if}
      <!-- scrollable region must be keyboard focusable (axe: scrollable-region-focusable) -->
      <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <div class="scroller" class:panmode={spaceDown} class:panning={!!panning} bind:this={scroller} bind:clientWidth={viewW} bind:clientHeight={viewH}
        role="region" aria-label="{tr('canvasEditor.cardCanvas')}" tabindex="0"
        on:scroll={syncView} on:wheel|nonpassive={onWheel} on:mousedown|capture={onPanDown}>
        <div class="stage-view-wrap"><div class="stage-view" bind:this={stageView}></div></div>
        <div class="frame" bind:this={frameEl}>
          <div class="stage-host" bind:this={stageHost}>
            <div class="stage-bed" bind:this={stageBed}></div>
            {#if editing}
              <textarea class="inline-edit" style={editCss} aria-label={tr('canvasEditor.editTextLabel')} bind:value={editing.value} use:focusAndSelect
                on:keydown={onEditKey} on:blur={() => finishEdit(true)} spellcheck="false"></textarea>
            {/if}
          </div>
        </div>
      </div>
      <div class="zoombar" role="group" aria-label={tr('canvasEditor.zoomGroup')}>
        <button class="z-btn" title={tr('canvasEditor.zoomOut')} aria-label={tr('canvasEditor.zoomOut')} on:click={() => zoomBy(0.8)}>−</button>
        <select class="z-select" aria-label={tr('canvasEditor.zoomLevel')} title={tr('canvasEditor.zoomLevel')} value={zoomValue} on:change={onZoomPick}>
          {#each zoomOptions as z}<option value={String(z)}>{Math.round(z * 100)}%</option>{/each}
          <option value="fit">{tr('canvasEditor.zoomFit')}</option>
        </select>
        <button class="z-btn" title={tr('canvasEditor.zoomIn')} aria-label={tr('canvasEditor.zoomIn')} on:click={() => zoomBy(1.25)}>+</button>
        <button class="z-btn wide" title={tr('canvasEditor.zoomFitTitle')} on:click={zoomFit}>{tr('canvasEditor.zoomFit')}</button>
      </div>
    </div>

    <ResizeHandle axis="x" grow={-1} min={LIMITS.props.min} max={LIMITS.props.max} reset={LIMITS.props.reset}
      value={$layout.props} label="{tr('resize.propertiesPanel')}" on:change={e => setLayout('props', e.detail)} />

    <div class="side" style="width:{$layout.props}px" bind:clientHeight={sideH}>
    <aside class="props" style="height:{topH}px" aria-label="{tr('canvasEditor.properties')}">
      {#if props}
        <h2 class="props-title">{#if multi}{tr('canvasEditor.nSelected', { n: selectedIds.length })}{:else}{props.tag} · {selectedId}{/if}</h2>
        {#if !multi}
        <details class="sec" open>
          <summary>{tr('canvasEditor.secPosition')}</summary>
        <div class="grid2">
          <label>X <input type="number" value={props.x} on:change={e => setGeometry('x', e.target.value)} /></label>
          <label>Y <input type="number" value={props.y} on:change={e => setGeometry('y', e.target.value)} /></label>
          <label>W <input type="number" value={props.w} disabled={boxes[selectedId]?.rotated} on:change={e => setGeometry('w', e.target.value)} /></label>
          <label>H <input type="number" value={props.h} disabled={boxes[selectedId]?.rotated} on:change={e => setGeometry('h', e.target.value)} /></label>
        </div>
        <label class="inline"><input type="checkbox" bind:checked={lockAspect} /> {tr('canvasEditor.lockAspectRatio')}</label>
        </details>

        {#if ['text', 'image', 'rect', 'ellipse', 'circle'].includes(props.tag)}
        <details class="sec" open>
          <summary>{tr('canvasEditor.secContent')}</summary>
          {#if props.tag === 'image'}
            <div class="fixed-image">
              <span class="image-name">{props.field === '__asset' ? (namesLoaded ? (assetNames[props.assetId] ?? tr('canvasEditor.fixedImageMissing')) : '') : tr('canvasEditor.noImageYet')}</span>
              <button class="primary" on:click={() => { assetPickerOpen = true; loadAssetNames() }}>{props.field === '__asset' ? tr('canvasEditor.changeImage') : tr('canvasEditor.chooseOrImportImage')}</button>
            </div>
            <label>{tr('canvasEditor.imageSource')}
              <select value={props.field} on:change={onBindingChange}>
                <option value="__asset">{tr('canvasEditor.imageFromLibrary')}</option>
                <option value="">{tr('canvasEditor.imageEmpty')}</option>
                <optgroup label={tr('canvasEditor.imageFromField')}>
                  {#each $fields.filter(f => f.type === 'image_ref') as f (f.id)}<option value={f.slug}>{f.name}</option>{/each}
                </optgroup>
              </select>
            </label>
          {:else}
          <label>{tr('canvasEditor.fieldBinding')}
            <select value={props.field} on:change={onBindingChange}>
              <option value="">{tr('common.none')}</option>
              <option value="display_name">{tr('canvasEditor.displayNameCardName')}</option>
              {#each $fields as f (f.id)}<option value={f.slug}>{f.name}</option>{/each}
            </select>
          </label>
          {/if}
          {#if props.tag === 'rect'}
            <button type="button" class="make-image" on:click={makeImage}>{tr('canvasEditor.makeImage')}</button>
          {/if}
        {#if props.tag === 'text' && !props.field && props.literal !== null}
          <label>{tr('canvasEditor.textContent')}
            <textarea class="literal" rows="3" value={props.literal} on:change={e => setLiteral(e.currentTarget.value)}></textarea>
          </label>
        {/if}

        </details>
        {/if}
        {#if props.partOf}
          <p class="part-of" role="note">{tr('canvasEditor.partOfComponent', { name: props.partOf.name })}
            <button on:click={() => select(props.partOf.id)}>{tr('canvasEditor.selectComponent')}</button></p>
        {/if}
        {#if props.component}
          <details class="sec comp" open>
            <summary>{tr('canvasEditor.secComponent')}</summary>
            <p class="comp-name"><strong>{props.component.name}</strong> <span class="dim">{tr('canvasEditor.componentVersion', { n: props.component.version })}</span></p>
            {#if libStatus === 'update'}<p class="note" role="status">{tr('canvasEditor.componentNewer', { n: libInfo.version })}</p>
            {:else if libStatus === 'missing'}<p class="note" role="status">{tr('canvasEditor.componentNotInLibrary')}</p>{/if}
            <div class="z">
              <button on:click={() => updateComponent(true)} disabled={libStatus !== 'update' && libStatus !== 'same'} title="{tr('canvasEditor.componentUpdateTitle')}">{tr('canvasEditor.componentUpdate')}</button>
              <button on:click={pushComponent} title="{tr('canvasEditor.componentPushTitle')}">{tr('canvasEditor.componentPush')}</button>
              <button on:click={detachComponent} title="{tr('canvasEditor.componentDetachTitle')}">{tr('canvasEditor.componentDetach')}</button>
            </div>
            {#if props.component.parts.length}
              <h3 class="sub">{tr('canvasEditor.componentParts')}</h3>
              <ul class="parts">
                {#each props.component.parts as p (p.part)}
                  <li class:changed={p.changed}>
                    <span class="pname">{p.part}</span>
                    {#if p.fill && /^#[0-9a-f]{6}$/i.test(p.fill)}<label class="mini">{tr('canvasEditor.componentFill')} <input type="color" value={p.fill} on:change={e => setPart(p.part, 'fill', e.target.value)} /></label>{/if}
                    {#if p.stroke && /^#[0-9a-f]{6}$/i.test(p.stroke)}<label class="mini">{tr('canvasEditor.componentStroke')} <input type="color" value={p.stroke} on:change={e => setPart(p.part, 'stroke', e.target.value)} /></label>{/if}
                    {#if p.text !== null}<label class="mini wide">{tr('canvasEditor.componentText')} <input value={p.text} on:change={e => setPart(p.part, 'text', e.target.value)} /></label>
                    {:else if p.tokens}<span class="dim tok">{p.tokens}</span>{/if}
                  </li>
                {/each}
              </ul>
              {#if props.component.parts.some(p => p.changed)}<button on:click={() => updateComponent(false)}>{tr('canvasEditor.componentReset')}</button>{/if}
            {/if}
          </details>
        {/if}
        {#if props.tag === 'text'}
          <details class="sec" open>
            <summary>{tr('canvasEditor.secText')}</summary>
          <label>{tr('canvasEditor.font')}
            <select value={props.fontFamily} on:change={e => setAttr('font-family', e.target.value)}>
              <option value="">{tr('canvasEditor.default')}</option>
              {#each fontFamilies as f}<option value={f}>{f}</option>{/each}
              <option value="serif">{tr('canvasEditor.serif')}</option><option value="sans-serif">{tr('canvasEditor.sansSerif')}</option><option value="monospace">{tr('canvasEditor.monospace')}</option>
            </select>
          </label>
          <div class="grid2 styles">
            <label>{tr('canvasEditor.textStyle')}
              <select value="" on:change={applyTextStyle} disabled={!textStyles.length}>
                <option value="">{textStyles.length ? tr('canvasEditor.applyStyle') : tr('canvasEditor.noStyles')}</option>
                {#each textStyles as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
              </select>
            </label>
            <button type="button" class="save-style" on:click={saveTextStyle}>{tr('canvasEditor.saveStyle')}</button>
          </div>
          <div class="grid2">
            <label>{tr('common.size')} <input type="number" min="1" value={props.fontSize} on:change={e => setAttr('font-size', e.target.value)} /></label>
            <label>{tr('canvasEditor.weight')}
              <select value={props.fontWeight} on:change={e => setAttr('font-weight', e.target.value)}>
                <option value="">{tr('canvasEditor.normal')}</option><option value="bold">{tr('canvasEditor.bold')}</option><option value="300">{tr('canvasEditor.light')}</option><option value="600">{tr('canvasEditor.semiBold')}</option><option value="900">{tr('canvasEditor.black')}</option>
              </select>
            </label>
            <label>{tr('common.style')}
              <select value={props.fontStyle} on:change={e => setAttr('font-style', e.target.value)}>
                <option value="">{tr('canvasEditor.normal')}</option><option value="italic">{tr('canvasEditor.italic')}</option>
              </select>
            </label>
            <label>{tr('canvasEditor.align')}
              <select value={props.textAlign === 'justify' ? 'justify' : props.anchor} on:change={e => setAttrs({ 'text-anchor': e.target.value === 'justify' ? 'start' : e.target.value, 'data-spadewick-text-align': e.target.value === 'justify' ? 'justify' : '' })}>
                <option value="start">{tr('canvasEditor.left')}</option><option value="middle">{tr('canvasEditor.center')}</option><option value="end">{tr('canvasEditor.right')}</option><option value="justify">{tr('canvasEditor.justify')}</option>
              </select>
            </label>
          </div>
          <label>{tr('canvasEditor.fitMode')}
            <select value={props.fit} on:change={e => setFit(e.target.value)}>
              <option value="">{tr('canvasEditor.noneSingleLine')}</option><option value="wrap">{tr('canvasEditor.wrapNoLimit')}</option><option value="shrink">{tr('canvasEditor.shrink')}</option><option value="overflow">{tr('canvasEditor.overflow')}</option><option value="truncate">{tr('canvasEditor.truncate')}</option><option value="clip">{tr('canvasEditor.clip')}</option>
            </select>
          </label>
          {#if $fields.find(f => f.slug === props.field)?.type === 'rich_text'}
            <label class="inline"><input type="checkbox" checked disabled /> {tr('canvasEditor.richTextAuto')}</label>
          {:else}
            <label class="inline"><input type="checkbox" checked={props.rich} on:change={e => setAttr('data-spadewick-rich', e.currentTarget.checked ? 'true' : '')} /> {tr('canvasEditor.richText')}</label>
          {/if}
          {#if fitFor?.fits === false}
            <p class="warn" role="status">{tr('canvasEditor.doesNotFit', { size: Math.round(fitFor.size * 10) / 10 })}</p>
          {/if}
          </details>
          <details class="sec typo" open>
            <summary>{tr('canvasEditor.typography')}</summary>
            <label>{tr('canvasEditor.lineHeight')} <input placeholder="1.2" aria-describedby="lh-hint" value={props.lineHeight} on:change={e => setAttr('data-spadewick-line-height', e.target.value.trim())} /></label>
            <span class="hint" id="lh-hint">{tr('canvasEditor.lineHeightHint')}</span>
            <div class="grid2">
              <label>{tr('canvasEditor.tracking')} <input type="number" step="5" value={props.tracking} on:change={e => setAttr('letter-spacing', e.target.value === '' ? '' : `${Number(e.target.value) / 1000}em`)} /></label>
              <label>{tr('canvasEditor.wordSpacing')} <input type="number" step="0.05" value={props.wordSpacing} on:change={e => setAttr('word-spacing', e.target.value === '' ? '' : `${e.target.value}em`)} /></label>
              <label>{tr('canvasEditor.paragraphSpacing')} <input type="number" min="0" max="3" step="0.1" value={props.paragraphSpacing} on:change={e => setAttr('data-spadewick-paragraph-spacing', e.target.value)} /></label>
              <label>{tr('canvasEditor.indent')} <input type="number" min="0" step="0.5" value={props.indent} on:change={e => setAttr('data-spadewick-indent', e.target.value)} /></label>
            </div>
            <label>{tr('canvasEditor.valign')}
              <select value={props.valign || 'top'} on:change={e => setAttr('data-spadewick-valign', e.target.value === 'top' ? '' : e.target.value)}>
                <option value="top">{tr('canvasEditor.top')}</option><option value="middle">{tr('canvasEditor.middle')}</option><option value="bottom">{tr('canvasEditor.bottom')}</option>
              </select>
            </label>
            <label>{tr('canvasEditor.transform')}
              <select value={props.transform} on:change={e => setAttr('data-spadewick-text-transform', e.target.value)}>
                <option value="">{tr('canvasEditor.transformNone')}</option><option value="uppercase">{tr('canvasEditor.uppercase')}</option><option value="lowercase">{tr('canvasEditor.lowercase')}</option><option value="title">{tr('canvasEditor.titleCase')}</option><option value="small-caps">{tr('canvasEditor.smallCaps')}</option>
              </select>
            </label>
            <label class="inline"><input type="checkbox" checked={props.bullets} on:change={e => setAttr('data-spadewick-bullets', e.currentTarget.checked ? 'true' : '')} /> {tr('canvasEditor.bullets')}</label>
            {#if props.bullets}<label>{tr('canvasEditor.bullet')} <input value={props.bullet} placeholder={tr('canvasEditor.bulletHint')} on:change={e => setAttr('data-spadewick-bullet', e.target.value.trim())} /></label>{/if}
            <label class="inline"><input type="checkbox" checked={props.balance} on:change={e => setAttrs(optional('data-spadewick-balance', e.currentTarget.checked))} /> {tr('canvasEditor.balance')}</label>
            <label class="inline"><input type="checkbox" checked={props.avoidOrphans} on:change={e => setAttrs(optional('data-spadewick-avoid-orphans', e.currentTarget.checked))} /> {tr('canvasEditor.avoidOrphans')}</label>
            <label>{tr('canvasEditor.outline')} <input value={props.outline} placeholder={tr('canvasEditor.outlineHint')} on:change={e => setAttr('data-spadewick-outline', e.target.value.trim())} /></label>
            <label>{tr('canvasEditor.shadow')} <input value={props.shadow} placeholder={tr('canvasEditor.shadowHint')} on:change={e => setAttr('data-spadewick-shadow', e.target.value.trim())} /></label>
            {#if props.fit === 'shrink'}
              <div class="grid2">
                <label>{tr('canvasEditor.step')}
                  <select value={props.step || '1'} on:change={e => setAttr('data-spadewick-text-step', e.target.value === '1' ? '' : e.target.value)}>
                    <option value="1">1</option><option value="0.5">0.5</option><option value="0.25">0.25</option>
                  </select>
                </label>
                <label>{tr('canvasEditor.tighten')} <input type="number" min="0" max="10" step="0.5" value={props.tighten} on:change={e => setAttr('data-spadewick-tighten', e.target.value)} /></label>
              </div>
              <label class="inline"><input type="checkbox" checked={!props.iconsFixed} on:change={e => setAttr('data-spadewick-icon-scale', e.currentTarget.checked ? '' : 'fixed')} /> {tr('canvasEditor.iconsInProportion')}</label>
            {/if}
            {#if props.fit}<label>{tr('canvasEditor.maxLines')} <input type="number" min="1" step="1" value={props.maxLines} on:change={e => setAttr('data-spadewick-text-max-lines', e.target.value)} /></label>{/if}
            {#if props.rich || $fields.find(f => f.slug === props.field)?.type === 'rich_text'}
              <label class="inline"><input type="checkbox" checked={!props.keywordsOff} on:change={e => setAttr('data-spadewick-keywords', e.currentTarget.checked ? '' : 'off')} /> {tr('canvasEditor.keywords')}</label>
            {/if}
          </details>
        {/if}

        {/if}

        <details class="sec" open>
          <summary>{tr('canvasEditor.secAppearance')}</summary>
        <AppearanceSection p={props} swatches={props.swatches} hasStroke={props.tag !== 'image'}
          on:attrs={e => setAttrs(e.detail)} on:fill={onFill} on:effects={onEffects} on:blend={onBlend} on:rotation={e => setRotation(e.detail)} />
        </details>

        <details class="sec" open>
          <summary>{tr('canvasEditor.secArrange')}</summary>
        <div class="z">
          <button on:click={() => zOrder('front')} title="{tr('canvasEditor.bringToFront')}">⤒</button>
          <button on:click={() => zOrder('forward')} title="{tr('canvasEditor.bringForward')}">↑</button>
          <button on:click={() => zOrder('backward')} title="{tr('canvasEditor.sendBackward')}">↓</button>
          <button on:click={() => zOrder('back')} title="{tr('canvasEditor.sendToBack')}">⤓</button>
          <button class="danger" on:click={deleteSelected} title="{tr('canvasEditor.deleteElement')}">🗑</button>
        </div>
        <div class="z">
          <button on:click={groupSelection} disabled={selectedIds.length < 2} title="{tr('canvasEditor.groupTitle')}">{tr('canvasEditor.group')}</button>
          <button on:click={ungroupSelection} title="{tr('canvasEditor.ungroupTitle')}">{tr('canvasEditor.ungroup')}</button>
          <button on:click={duplicateSelection} title="{tr('canvasEditor.duplicateTitle')}">{tr('canvasEditor.duplicate')}</button>
        </div>
        <div class="z">
          <button on:click={makeComponent} title="{tr('canvasEditor.makeComponentTitle')}">{tr('canvasEditor.makeComponent')}</button>
        </div>
        </details>

        <details class="sec" open>
          <summary>{tr('canvasEditor.secConditions')}</summary>
        <label>{tr('canvasEditor.showIf')} <input class="mono" placeholder="{tr('canvasEditor.eqTypeCreature')}" value={props.showIf} on:change={e => setAttr('data-spadewick-show-if', e.target.value)} /></label>
        <label>{tr('canvasEditor.hideIf')} <input class="mono" placeholder="{tr('canvasEditor.eqLegendaryFalse')}" value={props.hideIf} on:change={e => setAttr('data-spadewick-hide-if', e.target.value)} /></label>
        </details>
      {:else}
        <p class="hint">{tr('canvasEditor.selectAnElementToEdit')} <code>{tr('canvasEditor.dataSpadewickId')}</code> {tr('canvasEditor.attributeAreInteractiveUseThe')}</p>
      {/if}
    </aside>

    <ResizeHandle axis="y" grow={1} min={Math.round(sideH * LIMITS.propsSplit.min)} max={Math.round(sideH * LIMITS.propsSplit.max)} reset={Math.round(sideH * LIMITS.propsSplit.reset)}
      value={topH} label="{tr('resize.layersSplit')}" on:change={e => sideH > 0 && setLayout('propsSplit', e.detail / sideH)} />

    <LayersPanel
      {svgSource} {selectedId} {selectedIds} {hiddenIds} {lockedIds}
      on:select={e => { if (e.detail.additive) toggleSelect(e.detail.id); else select(e.detail.id) }}
      on:move={e => moveLayer(e.detail)}
      on:rename={e => renameLayer(e.detail)}
      on:hide={e => toggleHide(e.detail.id)}
      on:lock={e => toggleLock(e.detail.id)}
    />
    </div>
  </div>
</div>

{#if componentsOpen}
  <ComponentLibraryDialog fieldSlugs={$fields.map(f => f.slug)} on:insert={insertComponent} on:close={() => (componentsOpen = false)} />
{/if}

{#if assetPickerOpen}
  <AssetPicker current={props?.assetId || null} on:pick={e => setFixedImage(e.detail)} on:close={() => assetPickerOpen = false} />
{/if}

<div class="measure" bind:this={measureHost} aria-hidden="true"></div>

<style>
  .canvas-editor { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--color-surface); border-bottom: 1px solid var(--color-border); flex-wrap: wrap; }
  .group { display: flex; align-items: center; gap: 2px; padding: 2px; background: var(--color-surface-2); border-radius: var(--radius); }
  .group button { border-color: transparent; background: transparent; border-radius: var(--radius); box-shadow: none; }
  .group button:hover { background: color-mix(in srgb, var(--color-accent) 14%, transparent); border-color: transparent; }
  .tool { display: grid; place-items: center; width: 32px; height: 28px; padding: 0; }
  .chip { padding: 3px 10px; font-size: 12px; }
  .toolbar button.active { background: var(--gradient-accent); border-color: transparent; color: var(--color-on-accent); box-shadow: var(--glow); }
  .fixed-image { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 11px; }
  .fixed-image span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sep { width: 1px; height: 22px; background: var(--color-border); margin: 0 2px; }
  .spacer { flex: 1; }
  .picker { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-dim); }
  .banner { padding: 4px 10px; font-size: 11px; }
  .banner.err { background: color-mix(in srgb, var(--color-danger) 25%, transparent); }
  .banner.warn { background: color-mix(in srgb, #d9a400 20%, transparent); }
  .work { flex: 1; display: flex; min-height: 0; }

  /* The view: rulers that follow the zoom and the scroll, the scrolling canvas, and the zoom bar over its corner */
  .viewport { position: relative; flex: 1; min-width: 0; background: var(--color-surface-2); overflow: hidden; }
  .scroller { position: absolute; inset: 0; overflow: auto; min-width: 0; background: var(--color-surface-2) radial-gradient(color-mix(in srgb, var(--color-text-dim) 30%, transparent) 1px, transparent 1.4px) 0 0 / 20px 20px; }
  .viewport.rulers .scroller { inset: 22px 0 0 22px; }
  .scroller.panmode, .scroller.panmode :global(*) { cursor: grab !important; }
  .scroller.panning, .scroller.panning :global(*) { cursor: grabbing !important; }
  .frame { display: flex; box-sizing: border-box; width: max-content; min-width: 100%; min-height: 100%; padding: 24px; }
  .stage-host { position: relative; margin: auto; flex: none; box-shadow: var(--shadow-2); border-radius: 2px; background: #fff; line-height: 0; }
  /* the pasteboard: the stage reaches past the card on every side (its size and place are set with the zoom) */
  .stage-bed { position: absolute; line-height: 0; pointer-events: none; }
  /* the canvas: as big as the view, held still while the card scrolls under it */
  .stage-view-wrap { position: sticky; top: 0; left: 0; width: 0; height: 0; z-index: 1; }
  .stage-view { position: absolute; left: 0; top: 0; line-height: 0; }
  .inline-edit { position: absolute; z-index: 5; resize: none; overflow: hidden; border: 2px solid #3b2fb8; border-radius: 4px; padding: 2px 4px; line-height: 1.2; white-space: pre-wrap; box-shadow: var(--shadow-2); user-select: text; field-sizing: content; }
  .corner { position: absolute; left: 0; top: 0; width: 22px; height: 22px; background: var(--color-surface); border-right: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); z-index: 2; }
  .ruler { position: absolute; z-index: 2; overflow: hidden; background: var(--color-surface); font-size: 10px; color: var(--color-text-dim); pointer-events: none; }
  .ruler.h { left: 22px; right: 0; top: 0; height: 22px; border-bottom: 1px solid var(--color-border); }
  .ruler.v { left: 0; top: 22px; bottom: 0; width: 22px; border-right: 1px solid var(--color-border); }
  .ruler .extent { position: absolute; background: color-mix(in srgb, var(--color-accent) 16%, transparent); }
  .ruler.h .extent { top: 0; bottom: 0; }
  .ruler.v .extent { left: 0; right: 0; }
  .ruler .tick { position: absolute; background: var(--color-text-dim); }
  .ruler.h .tick { bottom: 0; width: 1px; height: 8px; }
  .ruler.h .tick.minor { height: 4px; opacity: .7; }
  .ruler.v .tick { right: 0; height: 1px; width: 8px; }
  .ruler.v .tick.minor { width: 4px; opacity: .7; }
  .ruler .tick i { position: absolute; font-style: normal; white-space: nowrap; }
  .ruler.h .tick i { left: 3px; bottom: 6px; }
  .ruler.v .tick i { right: 6px; top: 3px; transform-origin: 100% 0; writing-mode: vertical-rl; transform: rotate(180deg); }
  .zoombar { position: absolute; right: 14px; bottom: 14px; z-index: 3; display: flex; align-items: center; gap: 2px; padding: 3px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; box-shadow: var(--shadow-2); }
  .zoombar button, .zoombar select { border-color: transparent; background: transparent; box-shadow: none; }
  .zoombar button:hover, .zoombar select:hover { background: color-mix(in srgb, var(--color-accent) 14%, transparent); border-color: transparent; }
  .z-btn { width: 28px; padding: 2px 0; font-size: 16px; line-height: 1; }
  .z-btn.wide { width: auto; padding: 2px 10px; font-size: 12px; }
  .z-select { font-size: 12px; padding: 3px 4px; width: 76px; }
  .side { flex: none; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--color-surface); }
  .props { flex: none; min-height: 0; overflow: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; font-size: 11px; }
  .props-title { font-size: 12px; }
  .props label { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-dim); }
  .props label.inline { flex-direction: row; align-items: center; gap: 6px; }
  .props textarea.literal { resize: vertical; min-height: 54px; font-size: 12px; }
  .props .warn { color: var(--color-danger-text); font-size: 11px; margin: 2px 0; }
  .props .sec { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--color-border); }
  .props .sec:first-of-type { border-top: 0; padding-top: 0; }
  .props .sec > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: .04em; color: var(--color-text); padding: 2px 0 4px; }
  .props .sec > summary::-webkit-details-marker { display: none; }
  .props .sec > summary::before { content: ''; width: 6px; height: 6px; border-right: 2px solid var(--color-text-dim); border-bottom: 2px solid var(--color-text-dim); transform: rotate(-45deg); transition: transform .12s ease; flex: none; }
  .props .sec[open] > summary::before { transform: rotate(45deg); }
  .props .sec > summary:focus-visible { outline-offset: 1px; }
  .props .typo { gap: 4px; }
  .props input, .props select { width: 100%; min-width: 0; }
  .props input[type='checkbox'] { width: auto; }
  .part-of { margin: 0 0 8px; font-size: 11px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--color-surface-2); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .comp-name { margin: 0 0 6px; font-size: 12px; }
  .comp .note { margin: 0 0 6px; font-size: 11px; color: var(--color-text); border-left: 3px solid var(--color-accent-text); padding-left: 8px; }
  .parts { list-style: none; margin: 4px 0 6px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .parts li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 4px 6px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 11px; }
  .parts li.changed { border-color: var(--color-accent-text); }
  .parts .pname { font-weight: 600; min-width: 60px; }
  .parts .mini { display: flex; align-items: center; gap: 4px; }
  .parts .mini.wide { flex: 1 1 100%; }
  .parts .mini.wide input { flex: 1; min-width: 0; }
  .parts .tok { font-family: monospace; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .grid2.styles { align-items: end; }
  .color { display: flex; gap: 4px; }
  .color input[type='color'] { width: 30px; padding: 0; flex: none; }
  .z { display: flex; gap: 4px; }
  .danger { margin-left: auto; }
  .mono { font-family: var(--font-mono); }
  .hint { color: var(--color-text-dim); font-style: italic; }
  .measure { position: absolute; left: -99999px; top: 0; visibility: hidden; pointer-events: none; }
</style>
