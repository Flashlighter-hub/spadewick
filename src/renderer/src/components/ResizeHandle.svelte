<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * A divider the user can drag, or move with the arrow keys, to resize a panel (PRD §12.5).
   * `value` is the size in pixels of the panel being resized. `axis` is the direction of the drag: 'x' for a
   * vertical bar between side-by-side panels, 'y' for a horizontal bar between stacked ones. `grow` says which way
   * is "bigger": 1 when moving right/down grows the panel (the panel is before the bar), -1 when moving left/up
   * grows it (the panel is after the bar).
   */
  import { createEventDispatcher } from 'svelte'

  export let value = 200
  export let min = 100
  export let max = 600
  export let axis = 'x'
  export let grow = 1
  export let label = ''
  export let reset = null      // double-click or Home puts the panel back to this size (when given)
  const dispatch = createEventDispatcher()

  const STEP = 12
  let dragging = false
  let start = 0, startValue = 0

  const clamp = v => Math.min(max, Math.max(min, v))
  const set = v => { const next = Math.round(clamp(v)); if (next !== value) { value = next; dispatch('change', next) } }

  function down(e) {
    dragging = true
    start = axis === 'x' ? e.clientX : e.clientY
    startValue = value
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  function move(e) {
    if (!dragging) return
    const now = axis === 'x' ? e.clientX : e.clientY
    set(startValue + (now - start) * grow)
  }
  function up(e) {
    if (!dragging) return
    dragging = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    dispatch('end', value)
  }

  function key(e) {
    const more = axis === 'x' ? 'ArrowRight' : 'ArrowDown', less = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    let handled = true
    if (e.key === more) set(value + STEP * grow)
    else if (e.key === less) set(value - STEP * grow)
    else if (e.key === 'Home' && reset != null) set(reset)
    else if (e.key === 'PageUp') set(max)
    else if (e.key === 'PageDown') set(min)
    else handled = false
    if (handled) { e.preventDefault(); dispatch('end', value) }
  }
  function dbl() { if (reset != null) { set(reset); dispatch('end', value) } }
</script>

<!-- A separator that can be focused is a slider in all but name: it has a value and moves with the arrow keys -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex a11y-no-noninteractive-element-interactions -->
<div
  class="handle {axis}"
  class:dragging
  role="separator"
  aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
  aria-label={label}
  aria-valuenow={Math.round(value)}
  aria-valuemin={min}
  aria-valuemax={max}
  title={tr('resize.hint')}
  tabindex="0"
  on:pointerdown={down}
  on:pointermove={move}
  on:pointerup={up}
  on:pointercancel={up}
  on:keydown={key}
  on:dblclick={dbl}
/>

<style>
  .handle { flex: none; background: transparent; position: relative; touch-action: none; transition: background-color .12s ease; }
  .handle.x { width: 5px; cursor: col-resize; background: linear-gradient(var(--color-border), var(--color-border)) center / 1px 100% no-repeat; }
  .handle.y { height: 5px; cursor: row-resize; background: linear-gradient(var(--color-border), var(--color-border)) center / 100% 1px no-repeat; }
  /* a wider invisible target, so the bar is easy to grab without taking space */
  .handle::before { content: ''; position: absolute; }
  .handle.x::before { inset: 0 -3px; }
  .handle.y::before { inset: -3px 0; }
  .handle:hover, .handle.dragging { background: var(--color-accent-text); }
  .handle:focus-visible { outline: 2px solid var(--color-accent-text); outline-offset: -1px; background: var(--color-accent-text); }
  @media (forced-colors: active) { .handle { background: ButtonText; } .handle:hover, .handle.dragging, .handle:focus-visible { background: Highlight; } }
</style>
