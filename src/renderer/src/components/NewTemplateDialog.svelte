<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * New template — PRD §7.7, §10.6: a template is made with a name and a card size. The size is chosen here and
   * then locked: a template can only be used by sets of the same size.
   */
  import { createEventDispatcher } from 'svelte'
  import Modal from './Modal.svelte'
  import CardSizePicker from './CardSizePicker.svelte'

  export let initial = { cardSize: 'poker', cardMmW: 63.5, cardMmH: 88.9 }   // the active set's size
  const dispatch = createEventDispatcher()
  let name = ''
  let size = { ...initial }

  function submit() {
    if (!name.trim()) return
    dispatch('create', { name: name.trim(), ...size })
  }
</script>

<Modal title="{tr('newTemplate.title')}" width={460} on:close>
  <form data-prompt-dialog on:submit|preventDefault={submit}>
    <label class="stack">{tr('newTemplate.name')}
      <input class="field" bind:value={name} />
    </label>
    <CardSizePicker label="{tr('newTemplate.cardSize')}" value={size.cardSize} mmW={size.cardMmW} mmH={size.cardMmH} on:change={e => (size = e.detail)} />
    <p class="lock" role="note">{tr('newTemplate.locked')}</p>
    <div class="actions">
      <button type="button" on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
      <span class="spacer" />
      <button type="button" on:click={() => dispatch('library')}>{tr('newTemplate.fromLibrary')}</button>
      <button type="submit" class="primary">{tr('newTemplate.create')}</button>
    </div>
  </form>
</Modal>

<style>
  form { display: flex; flex-direction: column; gap: 10px; }
  .stack { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-dim); font-size: 11px; }
  .lock { font-size: 11px; color: var(--color-text); border-left: 3px solid var(--color-accent-text); padding-left: 8px; }
  .actions { display: flex; align-items: center; gap: 8px; }
  .spacer { flex: 1; }
</style>
