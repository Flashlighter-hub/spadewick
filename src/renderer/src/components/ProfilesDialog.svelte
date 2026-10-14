<script>
  import { askConfirm } from '../stores/prompt.js'
  /**
   * Output profiles (PRD §17.5): the CMYK profile that ships with the application and the ones imported from a manufacturer's file.
   * A profile that cannot be bundled for licence reasons is imported here; each one shows its licence note.
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import Modal from './Modal.svelte'
  import { toast } from '../stores/ui.js'

  const dispatch = createEventDispatcher()
  let list = { bundled: [], imported: [] }
  let note = ''
  let error = ''

  async function load() { list = await window.spadewick.profiles.list() }
  onMount(load)

  const reasons = { unreadable: tr('profiles.skipUnreadable'), tooLarge: tr('profiles.skipTooLarge'), notProfile: tr('profiles.skipNotProfile'), notCmykOutput: tr('profiles.skipNotCmyk') }

  async function importFiles() {
    error = ''
    try {
      const r = await window.spadewick.profiles.import({ licenceNote: note })
      for (const s of r.skipped) toast(tr('profiles.skipped', { file: s.file, reason: reasons[s.reason] ?? s.reason }), 'error', 7000)
      if (r.imported.length) { toast(tr('profiles.imported', { n: r.imported.length }), 'success', 3000); note = '' }
      await load()
    } catch (err) { error = err.message }
  }
  async function save(p, field, value) {
    error = ''
    try { await window.spadewick.profiles.update({ id: p.id, [field]: value }); await load() } catch (err) { error = err.message; await load() }
  }
  async function remove(p) {
    if (!await askConfirm(tr('profiles.confirmRemove', { name: p.name }))) return
    await window.spadewick.profiles.remove(p.id)
    await load(); dispatch('changed')
  }
</script>

<Modal title={tr('profiles.title')} width={760} on:close={() => dispatch('close')}>
  <p class="help">{tr('profiles.intro')}</p>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <table aria-label={tr('profiles.title')}>
    <thead><tr><th scope="col">{tr('profiles.name')}</th><th scope="col">{tr('profiles.source')}</th><th scope="col">{tr('profiles.licence')}</th><th scope="col"><span class="sr-only">{tr('profiles.actions')}</span></th></tr></thead>
    <tbody>
      {#each list.bundled as p (p.id)}
        <tr><td>{p.name}<div class="dim">{p.description}</div></td><td>{tr('profiles.bundled')}</td><td class="dim">{p.licenceNote}</td><td></td></tr>
      {/each}
      {#each list.imported as p (p.id)}
        <tr>
          <td><input class="field" value={p.name} aria-label={tr('profiles.nameOf', { name: p.name })} on:change={e => save(p, 'name', e.target.value)} /></td>
          <td>{tr('profiles.importedLabel')}</td>
          <td><input class="field" value={p.licenceNote} aria-label={tr('profiles.licenceOf', { name: p.name })} on:change={e => save(p, 'licenceNote', e.target.value)} /></td>
          <td><button type="button" on:click={() => remove(p)}>{tr('common.delete')}</button></td>
        </tr>
      {/each}
    </tbody>
  </table>
  <div class="import">
    <label>{tr('profiles.licenceForNew')} <input class="field" bind:value={note} placeholder={tr('profiles.licencePlaceholder')} /></label>
    <button type="button" on:click={importFiles}>{tr('profiles.import')}</button>
  </div>
  <p class="help">{tr('profiles.eci')}</p>
  <svelte:fragment slot="footer"><span style="flex:1" /><button type="button" class="primary" on:click={() => dispatch('close')}>{tr('common.done')}</button></svelte:fragment>
</Modal>

<style>
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
  .dim { color: var(--color-text-dim); font-size: 11px; }
  .help { font-size: 12px; color: var(--color-text-dim); }
  .err { color: var(--color-danger-text); font-size: 12px; }
  .import { display: flex; gap: 8px; align-items: flex-end; margin: 10px 0; }
  .import label { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--color-text-dim); }
  .field { width: 100%; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
