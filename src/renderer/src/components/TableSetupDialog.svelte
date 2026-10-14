<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * A new virtual table (PRD §7.9): which sets are on it as decks, how many hands, whether the decks are shuffled, and how many cards
   * each hand is dealt to begin with.
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import { MAX_SEATS } from '../../../shared/table.js'
  import { activeSetId } from '../stores/project.js'

  const dispatch = createEventDispatcher()
  let decks = []
  let loaded = false
  let chosen = {}                 // set id -> true
  let seats = 1
  let shuffle = true
  let copies = true
  let deal = 0

  onMount(async () => {
    decks = await window.spadewick.table.cards({})
    chosen = Object.fromEntries(decks.map(d => [d.id, d.id === $activeSetId]))
    if (!Object.values(chosen).some(Boolean) && decks[0]) chosen[decks[0].id] = true
    loaded = true
  })

  const total = d => d.cards.reduce((n, c) => n + (copies ? Math.max(0, c.quantity) : Math.min(1, Math.max(0, c.quantity))), 0)
  $: picked = decks.filter(d => chosen[d.id])
  $: canStart = picked.some(d => total(d) > 0)

  function start() {
    if (!canStart) return
    dispatch('start', { decks: picked, seats: Math.min(MAX_SEATS, Math.max(1, Math.round(seats) || 1)), shuffle, copies, deal: Math.max(0, Math.round(deal) || 0) })
  }
</script>

<Modal title="{tr('table.setupTitle')}" width={520} on:close>
  <form on:submit|preventDefault={start}>
    <fieldset class="decks">
      <legend>{tr('table.setupDecks')}</legend>
      {#each decks as d (d.id)}
        <label class="deck">
          <input type="checkbox" bind:checked={chosen[d.id]} />
          <span class="name">{d.name}</span>
          <span class="dim">{tr('table.setupCards', { n: total(d) })}</span>
          {#if !d.hasTemplate}<span class="warn">{tr('table.setupNoTemplate')}</span>{/if}
        </label>
      {:else}
        <p class="dim">{loaded ? tr('table.setupNoSets') : tr('table.loading')}</p>
      {/each}
    </fieldset>
    <div class="row">
      <label>{tr('table.setupSeats')} <input type="number" min="1" max={MAX_SEATS} bind:value={seats} /></label>
      <label>{tr('table.setupDeal')} <input type="number" min="0" max="30" bind:value={deal} /></label>
    </div>
    <label class="check"><input type="checkbox" bind:checked={shuffle} /> {tr('table.setupShuffle')}</label>
    <label class="check"><input type="checkbox" bind:checked={copies} /> {tr('table.setupCopies')}</label>
    <div class="actions">
      <button type="button" on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
      <span class="spacer" />
      <button type="submit" class="primary" disabled={!canStart}>{tr('table.setupStart')}</button>
    </div>
  </form>
</Modal>

<style>
  form { display: flex; flex-direction: column; gap: 12px; }
  .decks { border: 1px solid var(--color-control-border); border-radius: var(--radius); padding: 8px 10px; margin: 0; display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow: auto; }
  .decks legend { font-size: 11px; color: var(--color-text-dim); padding: 0 4px; }
  .deck { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .name { flex: 1; }
  .dim { color: var(--color-text-dim); font-size: 12px; }
  .warn { color: var(--color-danger-text); font-size: 11px; }
  .row { display: flex; gap: 18px; }
  .row label { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .row input { width: 64px; }
  .check { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .actions { display: flex; align-items: center; gap: 8px; }
  .spacer { flex: 1; }
</style>
