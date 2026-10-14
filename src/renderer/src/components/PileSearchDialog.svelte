<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * Looking through a pile (PRD §7.9): every card in it, the top first, and for each a way to take it: into a hand, or onto the table.
   * Nothing changes until a card is taken.
   */
  import { createEventDispatcher } from 'svelte'
  import Modal from './Modal.svelte'
  import TableCardFace from './TableCardFace.svelte'

  export let pile                        // the pile being looked through
  export let cards                       // state.cards: what each card is
  export let seats = 1
  const dispatch = createEventDispatcher()

  let filter = ''
  $: list = [...pile.cards].reverse().filter(id => !filter.trim() || (cards[id]?.name ?? '').toLowerCase().includes(filter.trim().toLowerCase()))
</script>

<Modal title="{tr('table.lookTitle', { name: pile.name || tr('table.aPile'), n: pile.cards.length })}" width={760} on:close>
  <label class="find">{tr('table.lookFilter')} <input class="field" bind:value={filter} /></label>
  <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
  <ul class="grid" tabindex="0" aria-label="{tr('table.lookCards')}">
    {#each list as id (id)}
      <li>
        <TableCardFace info={cards[id]} faceUp={true} width={110} />
        <span class="name">{cards[id]?.name}</span>
        <span class="takes">
          {#each Array.from({ length: seats }, (_, i) => i) as seat (seat)}
            <button on:click={() => dispatch('take', { card: id, to: { hand: seat } })} aria-label="{tr('table.takeToHand', { name: cards[id]?.name, seat: seat + 1 })}">{tr('table.handShort', { seat: seat + 1 })}</button>
          {/each}
          <button on:click={() => dispatch('take', { card: id, to: { table: true } })} aria-label="{tr('table.takeToTable', { name: cards[id]?.name })}">{tr('table.table')}</button>
        </span>
      </li>
    {:else}
      <li class="none">{tr('table.lookNone')}</li>
    {/each}
  </ul>
  <div class="actions"><span class="spacer" /><button on:click={() => dispatch('close')}>{tr('common.close')}</button></div>
</Modal>

<style>
  .find { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 8px; }
  .grid { list-style: none; margin: 0 0 10px; padding: 4px; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; max-height: 60vh; overflow: auto; }
  li { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .name { font-size: 11px; text-align: center; color: var(--color-text-dim); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .takes { display: flex; gap: 3px; flex-wrap: wrap; justify-content: center; }
  .takes button { font-size: 11px; padding: 1px 6px; }
  .none { grid-column: 1 / -1; color: var(--color-text-dim); font-style: italic; }
  .actions { display: flex; }
  .spacer { flex: 1; }
</style>
