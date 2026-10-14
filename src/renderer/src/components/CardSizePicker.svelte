<script>
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher } from 'svelte'
  import { CARD_SIZES } from '../../../shared/cardSizes.js'

  // value: a preset id or 'custom'. Every set and template has a size of its own (PRD §10.6): there is no "inherit"
  export let value = 'poker'
  export let mmW = 63.5
  export let mmH = 88.9
  export let label = tr('cardSizePicker.label')

  const dispatch = createEventDispatcher()
  function change(e) { value = e.target.value; emit() }
  function emit() { dispatch('change', { cardSize: value, cardMmW: Number(mmW), cardMmH: Number(mmH) }) }
</script>

<div class="picker">
  <label>
    <span>{label}</span>
    <select value={value ?? 'poker'} on:change={change}>
      {#each CARD_SIZES as s}<option value={s.id}>{tr(`cardSizes.${s.id}`)}</option>{/each}
      <option value="custom">{tr('common.custom')}</option>
    </select>
  </label>
  {#if value === 'custom'}
    <div class="custom">
      <input type="number" bind:value={mmW} on:change={emit} min="10" max="300" step="0.1" aria-label="{tr('cardSizePicker.widthMm')}" /> ×
      <input type="number" bind:value={mmH} on:change={emit} min="10" max="300" step="0.1" aria-label="{tr('cardSizePicker.heightMm')}" /> {tr('common.mm')}
    </div>
  {/if}
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: 4px; padding: 4px 10px; font-size: 11px; }
  label { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-dim); }
  select { width: 100%; }
  .custom { display: flex; align-items: center; gap: 4px; }
  .custom input { width: 64px; }
</style>
