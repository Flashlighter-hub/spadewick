<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * A button that opens a short menu (PRD §14.4): Enter, Space or Down open it and move into it, the arrow keys move
   * between items, Escape closes it and returns to the button, and so does choosing an item.
   * `items` is [{ id, label, danger?, disabled? }]; the chosen id is sent as `select`.
   */
  import { createEventDispatcher, tick } from 'svelte'

  export let label = ''
  export let items = []
  export let disabled = false

  const dispatch = createEventDispatcher()
  let open = false
  let button, menu

  const enabled = () => [...(menu?.querySelectorAll('button:not([disabled])') ?? [])]

  async function show(focusFirst = true) {
    open = true
    await tick()
    if (focusFirst) enabled()[0]?.focus()
  }
  function hide(refocus = true) { open = false; if (refocus) button?.focus() }

  function buttonKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show() }
  }
  function menuKey(e) {
    const list = enabled(), i = list.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
    else if (e.key === 'Tab') hide(false)
  }
  function choose(item) { hide(); dispatch('select', item.id) }
  function outside(e) { if (open && !menu?.contains(e.target) && !button?.contains(e.target)) hide(false) }
</script>

<svelte:window on:pointerdown={outside} />

<span class="wrap">
  <button bind:this={button} aria-haspopup="menu" aria-expanded={open} {disabled} on:click={() => (open ? hide(false) : show(false))} on:keydown={buttonKey}>{label} ▾</button>
  {#if open}
    <!-- the menu handles the arrow keys, Home, End and Escape for the buttons inside it -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <ul class="menu" role="menu" bind:this={menu} aria-label={label} on:keydown={menuKey}>
      {#each items as item (item.id)}
        <li role="none"><button role="menuitem" class:danger={item.danger} disabled={item.disabled} on:click={() => choose(item)}>{item.label}</button></li>
      {/each}
      {#if !items.length}<li role="none" class="empty">{tr('common.none')}</li>{/if}
    </ul>
  {/if}
</span>

<style>
  .wrap { position: relative; display: inline-block; }
  .menu { position: absolute; z-index: 30; top: 100%; right: 0; margin-top: 2px; min-width: 190px; list-style: none; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); box-shadow: 0 6px 24px rgba(0,0,0,.4); display: flex; flex-direction: column; }
  .menu button { width: 100%; text-align: left; background: none; border: none; border-radius: 3px; padding: 5px 8px; color: inherit; font-size: 12px; }
  .menu button:hover:not(:disabled), .menu button:focus-visible { background: var(--color-accent); color: var(--color-on-accent); outline: none; }
  .menu button:disabled { opacity: .5; }
  .menu .danger { color: var(--color-danger-text); }
  .menu .danger:hover:not(:disabled), .menu .danger:focus-visible { color: var(--color-on-accent); }
  .empty { padding: 5px 8px; color: var(--color-text-dim); font-size: 12px; }
</style>
