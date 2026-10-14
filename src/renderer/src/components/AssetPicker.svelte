<script>
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher, onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import { thumbUrl } from '../lib/thumbs.js'

  export let current = null   // currently assigned asset id
  const dispatch = createEventDispatcher()

  let assets = []
  let search = ''
  let urls = {}

  onMount(async () => {
    assets = await window.spadewick.assets.list({})
    for (const a of assets) thumbUrl(a.id).then(u => { urls[a.id] = u; urls = urls })
  })

  $: shown = assets.filter(a => !search || (a.original_name + ' ' + a.tags.join(' ') + ' ' + a.notes).toLowerCase().includes(search.toLowerCase()))

  async function importNew() {
    const added = await window.spadewick.assets.import()
    if (!added.length) return
    assets = await window.spadewick.assets.list({})
    for (const a of added) thumbUrl(a.id).then(u => { urls[a.id] = u; urls = urls })
    dispatch('pick', added[0].id)
  }
</script>

<Modal title="{tr('assetPicker.chooseImage')}" width={640} on:close>
  <div class="bar">
    <input type="search" placeholder="{tr('assetPicker.searchImages2')}" bind:value={search} aria-label="{tr('assetPicker.searchImages')}" />
    <button on:click={importNew}>{tr('assetPicker.import')}</button>
  </div>
  <div class="grid" role="listbox" aria-label="{tr('assetPicker.images')}">
    {#each shown as a (a.id)}
      <button class="item" class:current={a.id === current} role="option" aria-selected={a.id === current} on:click={() => dispatch('pick', a.id)} title={a.original_name}>
        {#if urls[a.id]}<img src={urls[a.id]} alt="" />{:else}<span class="ph">{a.mime_type === 'image/svg+xml' ? 'SVG' : '…'}</span>{/if}
        <span class="name">{a.original_name}</span>
      </button>
    {:else}
      <p class="empty">{assets.length ? tr('assetPicker.noMatch') : tr('assetPicker.noImages')}</p>
    {/each}
  </div>
  <svelte:fragment slot="footer">
    <button on:click={() => dispatch('pick', null)} disabled={!current}>{tr('assetPicker.clearImage')}</button>
    <button on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
  </svelte:fragment>
</Modal>

<style>
  .bar { display: flex; gap: 8px; } .bar input { flex: 1; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; max-height: 50vh; overflow: auto; }
  .item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; background: var(--color-surface-2); border: 2px solid transparent; }
  .item.current { border-color: var(--color-accent); }
  .item img, .ph { width: 80px; height: 80px; object-fit: contain; display: flex; align-items: center; justify-content: center; }
  .name { font-size: 10px; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: var(--color-text-dim); grid-column: 1 / -1; }
</style>
