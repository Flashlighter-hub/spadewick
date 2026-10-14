<script>
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher, onMount } from 'svelte'

  export let value = '#000000'
  const dispatch = createEventDispatcher()
  let hex = value
  const valid = v => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)
  let hexInput
  // Keyboard users land in the popup straight away, so Escape and Enter work without hunting for it
  onMount(() => hexInput?.focus())
  let emitted = false
  // Enter and the following change event both report the same colour; only the first counts
  const pick = v => { if (emitted) return; emitted = true; hex = v; dispatch('pick', v) }
</script>

<div class="shield" role="presentation" on:click={() => dispatch('close')} />
<!-- keydown only handles Escape; focus is moved into the popup on mount -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="popup" role="dialog" aria-label="{tr('colorPopup.chooseColor')}" on:keydown|stopPropagation={e => e.key === 'Escape' && dispatch('close')}>
  <input type="color" value={valid(hex) && hex.length === 7 ? hex : '#000000'} on:change={e => pick(e.target.value)} aria-label="{tr('colorPopup.colorPicker')}" />
  <input class="hex" bind:this={hexInput} bind:value={hex} aria-label="{tr('colorPopup.hexColor')}"
    on:keydown|stopPropagation={e => { if (e.key === 'Enter' && valid(hex)) { e.preventDefault(); pick(hex) } else if (e.key === 'Escape') dispatch('close') }} on:change={() => valid(hex) && pick(hex)} />
  <button on:click={() => pick('')}>{tr('colorPopup.clear')}</button>
</div>

<style>
  .shield { position: fixed; inset: 0; z-index: 40; }
  .popup { position: absolute; z-index: 41; top: 100%; left: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 8px; display: flex; flex-direction: column; gap: 6px; width: 170px; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
  .hex { font-family: var(--font-mono); }
  input[type='color'] { width: 100%; height: 30px; padding: 0; }
</style>
