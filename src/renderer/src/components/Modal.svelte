<script context="module">
  // Open modals, innermost last. Only the innermost one reacts to Escape and Tab.
  const openModals = []
</script>

<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * Accessible modal dialog (PRD §14.4).
   * Rendered into <body> so the rest of the app can be made `inert` while it is open: that keeps
   * keyboard focus and screen-reader navigation inside the dialog. Focus moves into the dialog when
   * it opens and returns to the control that opened it when it closes. Escape closes it.
   */
  import { createEventDispatcher, onMount, onDestroy } from 'svelte'

  export let title = ''
  export let width = 560
  const dispatch = createEventDispatcher()
  const close = () => dispatch('close')

  let dialogEl
  let opener = null
  const id = `dlg-${Math.random().toString(36).slice(2, 8)}`

  // Count open modals so nested ones (e.g. image picker over the card table) release `inert` correctly
  const appRoot = () => document.querySelector('.app-shell')
  function lockBackground() {
    const root = appRoot()
    if (!root) return
    root.dataset.modals = String(Number(root.dataset.modals ?? 0) + 1)
    root.setAttribute('inert', '')
    root.setAttribute('aria-hidden', 'true')
  }
  function unlockBackground() {
    const root = appRoot()
    if (!root) return
    const n = Math.max(0, Number(root.dataset.modals ?? 1) - 1)
    root.dataset.modals = String(n)
    if (n === 0) { root.removeAttribute('inert'); root.removeAttribute('aria-hidden') }
  }

  /** Move the node to <body> (outside the inert app shell). */
  function portal(node) {
    document.body.appendChild(node)
    return { destroy() { node.remove() } }
  }

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

  onMount(() => {
    openModals.push(id)
    opener = document.activeElement
    lockBackground()
    // Focus the first control in the body (not the close button) so typing can start immediately
    const first = dialogEl.querySelector(`.body ${FOCUSABLE.split(', ').join(', .body ')}`) ?? dialogEl.querySelector(FOCUSABLE)
    first?.focus()
  })

  onDestroy(() => {
    openModals.splice(openModals.indexOf(id), 1)
    unlockBackground()
    // Return focus to whatever opened the dialog, if it is still on the page
    if (opener && document.contains(opener)) opener.focus?.()
  })

  /**
   * Escape and Tab are handled for the whole window, not just while focus is inside the dialog:
   * a button that disables itself (and so drops focus to <body>) must not strand keyboard users.
   */
  function onWindowKeydown(e) {
    if (openModals[openModals.length - 1] !== id) return
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return }
    if (e.key !== 'Tab') return
    const items = [...dialogEl.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
    if (!items.length) return
    const first = items[0], last = items[items.length - 1]
    const inside = dialogEl.contains(document.activeElement)
    if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus() }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
</script>

<svelte:window on:keydown={onWindowKeydown} />

<div class="backdrop" role="presentation" use:portal on:mousedown|self={close}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="{id}-title" style="width:{width}px" bind:this={dialogEl}>
    <div class="head"><h2 id="{id}-title">{title}</h2><button class="x" on:click={close} aria-label="{tr('modal.closeDialog')}">✕</button></div>
    <div class="body"><slot /></div>
    {#if $$slots.footer}<div class="foot"><slot name="footer" /></div>{/if}
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(6, 8, 20, .58); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .dialog { background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-2); overflow: hidden; max-width: 94vw; max-height: 86vh; display: flex; flex-direction: column; }
  .head, .foot { display: flex; align-items: center; gap: 8px; padding: 10px 16px; }
  .head, .foot { background: color-mix(in srgb, var(--color-surface-2) 55%, var(--color-surface)); }
  .head { justify-content: space-between; border-bottom: 1px solid var(--color-border); }
  .head h2 { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
  .foot { border-top: 1px solid var(--color-border); justify-content: flex-end; }
  .body { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
  .x { background: none; border: none; color: var(--color-text-dim); }
</style>
