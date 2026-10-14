<script>
  /**
   * The Preset menu of the export dialog (PRD §18.4): choosing a manufacturer's preset fills in the settings; any change turns the
   * label into "Custom (based on …)". Beside it: where the values come from and when they were read, what could not be confirmed,
   * a card size the manufacturer does not offer, and a reminder to read the manufacturer's current guide and order a proof.
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import PresetsDialog from './PresetsDialog.svelte'

  export let kind = 'pdf'            // 'pdf' | 'images': only the presets that apply are offered
  export let setId = null            // the set the export is for: its card size is checked against the preset
  export let presetId = ''           // the chosen preset ('' for none)
  export let modified = false        // the settings were changed after the preset was applied
  export let notes = null            // the notes of the applied preset (from presets:apply)
  const dispatch = createEventDispatcher()

  let presets = [], problems = []
  let dialogOpen = false

  async function load() { const r = await window.spadewick.presets.list({ kind }); presets = r.presets; problems = r.problems }
  onMount(load)

  async function choose(e) {
    const id = e.target.value
    presetId = id
    if (!id) { notes = null; dispatch('apply', null); return }
    const applied = await window.spadewick.presets.apply({ id, setId })
    notes = applied.notes
    dispatch('apply', applied)
  }

  $: current = presets.find(p => p.id === presetId)
  const fieldName = f => ({ bleed: tr('presets.fBleed'), safe: tr('presets.fSafe'), dpi: tr('presets.fDpi'), colour: tr('presets.fColour'), profile: tr('presets.fProfile'), standard: tr('presets.fStandard'), die: tr('presets.fDie'), deck: tr('presets.fDeck'), sizes: tr('presets.fSizes'), pixels: tr('presets.fPixels') }[f] ?? f)
  const vectorName = r => (r === 'pureBlackText' ? tr('presets.rPureBlack') : r === 'overprintBlack' ? tr('presets.rOverprint') : tr('presets.rRichBlack'))
</script>

<div class="bar">
  <div class="row">
    <label for="preset-menu" class="label">{tr('presets.label')}</label>
    <select id="preset-menu" value={presetId} on:change={choose}>
      <option value="">{tr('presets.none')}</option>
      {#each presets.filter(p => p.shipped) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      {#if presets.some(p => !p.shipped)}
        <optgroup label={tr('presets.mine')}>{#each presets.filter(p => !p.shipped) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</optgroup>
      {/if}
    </select>
    <button type="button" on:click={() => (dialogOpen = true)}>{tr('presets.manage')}</button>
    {#if presetId && modified && current}<span class="custom" role="status">{tr('presets.custom', { name: current.name })}</span>{/if}
  </div>

  {#if notes && current}
    <ul class="info" aria-label={tr('presets.about')}>
      <li>{notes.manufacturer ? tr('presets.source', { who: notes.manufacturer, date: notes.checkedOn }) : tr('presets.sourceDate', { date: notes.checkedOn })}
        {#if current.stale}<strong class="warn"> {tr('presets.recheck')}</strong>{/if}
        {#if !notes.proofTested} {tr('presets.notTested')}{/if}</li>
      <li>{tr('presets.reminder')}{#if notes.guideUrl} <span class="url">{notes.guideUrl}</span>{/if}</li>
      {#if notes.notesText}<li class="dim">{notes.notesText}</li>{/if}
      {#if notes.verify?.length}<li class="warn">{tr('presets.verify', { fields: notes.verify.map(fieldName).join(', ') })}</li>{/if}
      {#if !notes.sizeOk}<li class="warn" role="alert">{tr('presets.sizeNotOffered', { name: current.name, sizes: (notes.sizes ?? []).join(', '), size: notes.size })}</li>{/if}
      {#if notes.profile && !notes.profile.found}<li class="warn">{tr('presets.profileNeeded', { profile: notes.profile.hint })}</li>{/if}
      {#if notes.needsVector?.length}<li class="dim">{tr('presets.needsVector', { rules: notes.needsVector.map(vectorName).join(', ') })}</li>{/if}
    </ul>
  {/if}
  {#if problems.length}<p class="warn">{tr('presets.problems', { n: problems.length })}</p>{/if}
</div>

{#if dialogOpen}<PresetsDialog on:close={() => { dialogOpen = false; load() }} />{/if}

<style>
  .bar { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--color-border); padding: 8px 10px; border-radius: 4px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
  .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--color-text-dim); }
  .custom { color: var(--color-text); font-weight: 600; }
  .info { margin: 0; padding-left: 18px; font-size: 11px; display: flex; flex-direction: column; gap: 2px; }
  .dim { color: var(--color-text-dim); }
  .warn { color: var(--color-warning-text); }
  .url { color: var(--color-text-dim); word-break: break-all; }
</style>
