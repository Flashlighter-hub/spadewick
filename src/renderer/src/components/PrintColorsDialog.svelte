<script>
  /**
   * Print colours (PRD §17.5, §28.3): a colour of the design with exact ink values and/or a spot colour name, matched to the design
   * by its screen colour. Where a flat area has exactly that colour, a production export prints these inks instead of the profile's
   * conversion. A spot name is kept for the vector output; the raster output prints it as its inks and says so.
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import Modal from './Modal.svelte'

  const dispatch = createEventDispatcher()
  let colors = []
  let error = ''
  let draft = { name: '', rgb: '#000000', useInk: true, cmyk: [0, 0, 0, 100], spotName: '' }

  async function load() { colors = await window.spadewick.printColors.list() }
  onMount(load)

  async function add() {
    error = ''
    try {
      await window.spadewick.printColors.create({ name: draft.name, rgb: draft.rgb, cmyk: draft.useInk ? draft.cmyk.map(Number) : null, spotName: draft.spotName })
      draft = { name: '', rgb: '#000000', useInk: true, cmyk: [0, 0, 0, 100], spotName: '' }
      await load(); dispatch('changed')
    } catch (err) { error = err.message }
  }
  async function change(c, patch) {
    error = ''
    try { await window.spadewick.printColors.update({ id: c.id, ...patch }); await load(); dispatch('changed') } catch (err) { error = err.message; await load() }
  }
  async function setInk(c, i, value) {
    const cmyk = [...(c.cmyk ?? [0, 0, 0, 0])]
    cmyk[i] = Number(value)
    await change(c, { cmyk })
  }
  async function remove(c) { await window.spadewick.printColors.remove(c.id); await load(); dispatch('changed') }
  const INKS = ['C', 'M', 'Y', 'K']
</script>

<Modal title={tr('printColors.title')} width={820} on:close={() => dispatch('close')}>
  <p class="help">{tr('printColors.intro')}</p>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <table aria-label={tr('printColors.title')}>
    <thead><tr>
      <th scope="col">{tr('printColors.name')}</th><th scope="col">{tr('printColors.screen')}</th><th scope="col">{tr('printColors.inks')}</th><th scope="col">{tr('printColors.spot')}</th><th scope="col"><span class="sr-only">{tr('printColors.actions')}</span></th>
    </tr></thead>
    <tbody>
      {#each colors as c (c.id)}
        <tr>
          <td><input class="field" value={c.name} aria-label={tr('printColors.nameOf', { name: c.name })} on:change={e => change(c, { name: e.target.value })} /></td>
          <td><input type="color" value={c.rgb} aria-label={tr('printColors.screenOf', { name: c.name })} on:change={e => change(c, { rgb: e.target.value })} /></td>
          <td>
            <div class="inks">
              {#each INKS as ink, i}
                <label>{ink} <input type="number" min="0" max="100" step="0.5" value={c.cmyk ? c.cmyk[i] : ''} placeholder="–" aria-label={tr('printColors.inkOf', { ink, name: c.name })} on:change={e => setInk(c, i, e.target.value)} /></label>
              {/each}
              {#if c.cmyk}<button type="button" on:click={() => change(c, { cmyk: null })}>{tr('printColors.clearInk')}</button>{/if}
            </div>
          </td>
          <td><input class="field" value={c.spotName ?? ''} aria-label={tr('printColors.spotOf', { name: c.name })} on:change={e => change(c, { spotName: e.target.value })} /></td>
          <td><button type="button" on:click={() => remove(c)}>{tr('common.delete')}</button></td>
        </tr>
      {/each}
      {#if !colors.length}<tr><td colspan="5" class="dim">{tr('printColors.none')}</td></tr>{/if}
    </tbody>
  </table>

  <form class="add" on:submit|preventDefault={add} aria-label={tr('printColors.add')}>
    <label>{tr('printColors.name')} <input class="field" bind:value={draft.name} /></label>
    <label>{tr('printColors.screen')} <input type="color" bind:value={draft.rgb} /></label>
    <fieldset>
      <legend><label><input type="checkbox" bind:checked={draft.useInk} /> {tr('printColors.inks')}</label></legend>
      {#if draft.useInk}
        <div class="inks">
          {#each INKS as ink, i}<label>{ink} <input type="number" min="0" max="100" step="0.5" bind:value={draft.cmyk[i]} aria-label={tr('printColors.newInk', { ink })} /></label>{/each}
        </div>
      {/if}
    </fieldset>
    <label>{tr('printColors.spot')} <input class="field" bind:value={draft.spotName} /></label>
    <button type="submit" class="primary" disabled={!draft.name.trim()}>{tr('printColors.add')}</button>
  </form>
  <p class="help">{tr('printColors.spotNote')}</p>
  <svelte:fragment slot="footer"><span style="flex:1" /><button type="button" class="primary" on:click={() => dispatch('close')}>{tr('common.done')}</button></svelte:fragment>
</Modal>

<style>
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
  .inks { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .inks label { display: flex; gap: 2px; align-items: center; font-size: 11px; }
  .inks input { width: 52px; }
  .add { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-top: 12px; border-top: 1px solid var(--color-border); padding-top: 10px; font-size: 11px; }
  .add label { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-dim); }
  .add fieldset { border: none; padding: 0; margin: 0; }
  .help { font-size: 12px; color: var(--color-text-dim); }
  .err { color: var(--color-danger-text); font-size: 12px; }
  .dim { color: var(--color-text-dim); }
  .field { width: 100%; min-width: 90px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
