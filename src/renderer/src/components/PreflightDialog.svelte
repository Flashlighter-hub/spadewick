<script>
  /**
   * Project → Check print readiness… (PRD §17.7): the same checks that gate a production export, run on their own. They use the
   * production settings last chosen in the export dialog, and the minimums kept in the project.
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import Modal from './Modal.svelte'
  import PreflightList from './PreflightList.svelte'
  import { sets, activeSetId } from '../stores/project.js'
  import { toast } from '../stores/ui.js'

  const dispatch = createEventDispatcher()
  let result = null, running = false, error = '', onlyErrors = false
  let selected = []
  let mins = null
  let options = {}

  async function run() {
    running = true; error = ''
    try { result = await window.spadewick.preflight.run({ ...options, setIds: selected }); mins = { ...result.minimums } } catch (err) { error = err.message } finally { running = false }
  }

  onMount(async () => {
    try { const last = await window.spadewick.settings.get('production_options'); if (last && typeof last === 'object') { const { noInkLimit, ...rest } = last; options = { ...rest, inkLimit: noInkLimit ? null : Number(rest.inkLimit) } } } catch { /* the defaults are fine */ }
    selected = $activeSetId ? [$activeSetId] : $sets.map(s => s.id)
    mins = await window.spadewick.preflight.getMinimums()
    run()
  })

  function toggle(id) { selected = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id] }

  async function saveMins() {
    error = ''
    try { mins = await window.spadewick.preflight.setMinimums(mins); toast(tr('preflight.minimumsSaved'), 'success', 2500); await run() } catch (err) { error = err.message }
  }
  async function resetMins() { mins = await window.spadewick.preflight.defaultMinimums() }

  const FIELDS = ['textPt', 'reversedTextPt', 'strokePt', 'ppiWarn', 'ppiError', 'smallBlackPt']
  const label = k => (k === 'textPt' ? tr('preflight.textPt') : k === 'reversedTextPt' ? tr('preflight.reversedTextPt') : k === 'strokePt' ? tr('preflight.strokePt') : k === 'ppiWarn' ? tr('preflight.ppiWarn') : k === 'ppiError' ? tr('preflight.ppiError') : tr('preflight.smallBlackPt'))
</script>

<Modal title={tr('preflight.title')} width={980} on:close={() => dispatch('close')}>
  <div class="bar">
    <fieldset class="sets">
      <legend class="sr-only">{tr('exportDialog.setsToExport')}</legend>
      {#each $sets as set (set.id)}<label><input type="checkbox" checked={selected.includes(set.id)} on:change={() => toggle(set.id)} /> {set.name}</label>{/each}
    </fieldset>
    <button type="button" on:click={run} disabled={running || !selected.length}>{tr('preflight.run')}</button>
    <label class="check"><input type="checkbox" bind:checked={onlyErrors} /> {tr('preflight.onlyErrors')}</label>
    {#if result}<span class="summary" role="status">{tr('preflight.summary', { n: result.checked, errors: result.counts.error, warnings: result.counts.warning, info: result.counts.info })}</span>{/if}
  </div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  {#if running && !result}<p class="dim" role="status">{tr('preflight.running')}</p>{/if}
  <PreflightList {result} {onlyErrors} on:show={e => { dispatch('show', e.detail); dispatch('close') }} />

  {#if mins}
    <details class="mins">
      <summary>{tr('preflight.minimums')}</summary>
      <p class="dim">{tr('preflight.minimumsHelp')}</p>
      <div class="grid">
        {#each FIELDS as k}<label>{label(k)} <input type="number" step="any" bind:value={mins[k]} /></label>{/each}
        <label class="inline"><input type="checkbox" bind:checked={mins.requireDieLine} /> {tr('preflight.requireDieLine')}</label>
      </div>
      <div class="row"><button type="button" on:click={saveMins}>{tr('preflight.saveMinimums')}</button><button type="button" on:click={resetMins}>{tr('preflight.resetMinimums')}</button></div>
    </details>
  {/if}
  <svelte:fragment slot="footer"><span style="flex:1" /><button type="button" class="primary" on:click={() => dispatch('close')}>{tr('common.done')}</button></svelte:fragment>
</Modal>

<style>
  .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .sets { border: none; padding: 0; margin: 0; display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; }
  .summary { margin-left: auto; font-size: 12px; color: var(--color-text-dim); }
  .check { font-size: 12px; display: flex; gap: 4px; align-items: center; }
  .err { color: var(--color-danger-text); font-size: 12px; }
  .dim { color: var(--color-text-dim); font-size: 12px; }
  .mins { margin-top: 12px; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; margin: 8px 0; }
  .grid label { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-dim); font-size: 11px; }
  .grid label.inline { flex-direction: row; align-items: center; gap: 6px; }
  .row { display: flex; gap: 8px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
