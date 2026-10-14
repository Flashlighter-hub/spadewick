<script>
  import { askConfirm } from '../stores/prompt.js'
  import { tr } from '../../../shared/i18n.js'
  /** The tables saved in the project (PRD §7.9): open one, or delete it. */
  import { createEventDispatcher, onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import { toast } from '../stores/ui.js'

  const dispatch = createEventDispatcher()
  let saved = []
  let loaded = false

  async function refresh() { saved = await window.spadewick.table.list(); loaded = true }
  onMount(refresh)

  async function remove(t) {
    if (!await askConfirm(tr('table.confirmDelete', { name: t.name }))) return
    try { await window.spadewick.table.delete(t.id); await refresh() } catch (err) { toast(err.message, 'error', 5000) }
  }
  const when = ms => new Date(ms).toLocaleString()
</script>

<Modal title="{tr('table.openTitle')}" width={480} on:close>
  {#if saved.length}
    <ul class="saved" aria-label="{tr('table.savedTables')}">
      {#each saved as t (t.id)}
        <li>
          <button class="open" on:click={() => dispatch('open', t.id)}>
            <span class="name">{t.name}</span>
            <span class="dim">{tr('table.savedInfo', { n: t.cards, when: when(t.saved) })}</span>
          </button>
          <button class="del" aria-label="{tr('table.deleteTable', { name: t.name })}" on:click={() => remove(t)}>✕</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="dim">{loaded ? tr('table.noSavedTables') : tr('table.loading')}</p>
  {/if}
  <div class="actions"><span class="spacer" /><button on:click={() => dispatch('close')}>{tr('common.close')}</button></div>
</Modal>

<style>
  .saved { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow: auto; }
  li { display: flex; gap: 6px; }
  .open { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 8px 12px; }
  .name { font-weight: 600; }
  .dim { color: var(--color-text-dim); font-size: 12px; }
  .del { width: 36px; }
  .actions { display: flex; }
  .spacer { flex: 1; }
</style>
