<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * New set — PRD §5.2, §10.6: a set is made with a name and its own card size. Poker is preselected;
   * the size can be changed later (with a warning if that affects templates).
   */
  import { createEventDispatcher } from 'svelte'
  import Modal from './Modal.svelte'
  import CardSizePicker from './CardSizePicker.svelte'

  const dispatch = createEventDispatcher()
  let name = ''
  let size = { cardSize: 'poker', cardMmW: 63.5, cardMmH: 88.9 }

  function submit() {
    if (!name.trim()) return
    dispatch('create', { name: name.trim(), ...size })
  }
</script>

<Modal title="{tr('newSet.title')}" width={440} on:close>
  <form data-prompt-dialog on:submit|preventDefault={submit}>
    <label class="stack">{tr('newSet.name')}
      <input class="field" bind:value={name} />
    </label>
    <CardSizePicker label="{tr('newSet.cardSize')}" value={size.cardSize} mmW={size.cardMmW} mmH={size.cardMmH} on:change={e => (size = e.detail)} />
    <p class="dim">{tr('newSet.sizeHelp')}</p>
    <div class="actions">
      <button type="button" on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
      <button type="submit" class="primary">{tr('newSet.create')}</button>
    </div>
  </form>
</Modal>

<style>
  form { display: flex; flex-direction: column; gap: 10px; }
  .stack { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-dim); font-size: 11px; }
  .dim { color: var(--color-text-dim); font-size: 11px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
