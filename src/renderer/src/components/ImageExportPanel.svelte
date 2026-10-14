<script>
  // names of file formats and colour models: the same in every language
  const NAMES = { png: 'PNG', jpeg: 'JPEG', cmyk: 'CMYK', rgb: 'RGB', x4: 'PDF/X-4', x1a: 'PDF/X-1a', url: 'https://' }
  /**
   * Per-card images for a print service (PRD §18.2, §18.4): every card as a PNG or JPEG of the pixel size that the trim plus the bleed
   * make at the resolution, with the bleed the template provides or made from its edge, and one shared card back. A preset fills the
   * numbers in; the pixel size the manufacturer states is shown beside the one the settings make.
   */
  import { onMount, onDestroy, createEventDispatcher } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import PresetBar from './PresetBar.svelte'
  import PreflightList from './PreflightList.svelte'

  export let setId = null
  export let selection = {}          // { setIds, cardIds, filter, cardBack, cardBackColor, cardBackAssetId }: what the export covers, for the print readiness check
  export let exportAnyway = false    // set by the person when the check has errors and the export should go ahead
  const dispatch = createEventDispatcher()
  let s = { bleedMm: 3, safeMm: 3, dpi: 300, imageFormat: 'png', jpegQuality: 92 }
  let presetId = '', applied = null, notes = null, image = null
  let size = null              // { mmW, mmH } of the set
  let loaded = false

  export function options() { return { ...s } }

  let pre = null, preBusy = false, preError = '', preOpen = false, timer
  onDestroy(() => clearTimeout(timer))
  onMount(async () => {
    try { const last = await window.spadewick.settings.get('image_export_options'); if (last && typeof last === 'object') { const { presetId: id, ...rest } = last; s = { ...s, ...rest }; presetId = id ?? '' } } catch { /* the defaults are fine */ }
    loaded = true
    await loadSize()
  })
  async function loadSize() { try { size = setId ? await window.spadewick.cardSize.get(setId) : null } catch { size = null } }
  $: setId, loaded && loadSize()
  $: if (loaded) { try { window.spadewick.settings.set('image_export_options', { ...s, presetId }) } catch { /* remembered only when it can be */ } }

  // The print readiness check (PRD §17.7) for these settings and this selection: the same checks as for a production file, in RGB
  $: if (loaded) { JSON.stringify([s, presetId, selection]); schedule() }
  function schedule() { clearTimeout(timer); timer = setTimeout(refreshPreflight, 450) }
  async function refreshPreflight() {
    if (!selection.setIds?.length) { pre = null; dispatch('preflight', null); return }
    preBusy = true; preError = ''
    try {
      pre = await window.spadewick.preflight.run({
        colour: 'rgb', standard: 'plain', bleedMm: Number(s.bleedMm) || 0, safeMm: Number(s.safeMm) || 0, dpi: Number(s.dpi) || 300,
        setIds: selection.setIds, cardIds: selection.cardIds, filter: selection.filter, cardBack: selection.cardBack, cardBackColor: selection.cardBackColor, cardBackAssetId: selection.cardBackAssetId,
        preset: presetId && notes ? { name: notes.name, sizeOk: notes.sizeOk, sizes: notes.sizes, size: notes.size, profile: null, verify: notes.verify, needsVector: [], deck: extras?.deck } : undefined,
        minimums: presetId && extras ? extras.minimums : undefined
      })
      if (!pre.counts.error) exportAnyway = false
      dispatch('preflight', pre)
    } catch (err) { preError = err.message; pre = null; dispatch('preflight', null) } finally { preBusy = false }
  }

  let extras = null
  function apply(e) {
    const a = e.detail
    if (!a) { applied = null; image = null; extras = null; return }
    extras = { minimums: a.minimums, deck: a.deck }
    applied = a.options
    image = a.image
    s = { ...s, bleedMm: a.options.bleedMm, safeMm: a.options.safeMm, dpi: a.options.dpi, imageFormat: a.image.format }
  }
  $: modified = !!applied && (s.bleedMm !== applied.bleedMm || s.safeMm !== applied.safeMm || s.dpi !== applied.dpi || (image && s.imageFormat !== image.format))
  const px = (mm, bleed, dpi) => Math.round((mm + 2 * bleed) / 25.4 * dpi)
  $: made = size ? { w: px(size.mmW, Number(s.bleedMm) || 0, Number(s.dpi) || 300), h: px(size.mmH, Number(s.bleedMm) || 0, Number(s.dpi) || 300) } : null
  $: states = image?.pixels ?? null
  $: differs = made && states && (Math.abs(made.w - states.width) > 1 || Math.abs(made.h - states.height) > 1)
</script>

<div class="panel">
  <PresetBar kind="images" {setId} bind:presetId bind:notes {modified} on:apply={apply} />
  <section>
    <span class="label">{tr('imageExport.settings')}</span>
    <label class="row"><span class="fl">{tr('production.bleed')}</span><input type="number" min="0" max="20" step="0.025" bind:value={s.bleedMm} style="width:80px" /> {tr('common.mm')}</label>
    <label class="row"><span class="fl">{tr('imageExport.dpi')}</span><input type="number" min="72" max="1200" step="1" bind:value={s.dpi} style="width:80px" /></label>
    <label class="row"><span class="fl">{tr('imageExport.format')}</span>
      <select bind:value={s.imageFormat}><option value="png">{NAMES.png}</option><option value="jpeg">{NAMES.jpeg}</option></select></label>
    {#if s.imageFormat === 'jpeg'}<label class="row"><span class="fl">{tr('imageExport.quality')}</span><input type="number" min="50" max="100" step="1" bind:value={s.jpegQuality} style="width:70px" /></label>{/if}
    {#if made}<p class="dim" role="status">{tr('imageExport.size', { w: made.w, h: made.h })}</p>{/if}
    {#if differs}<p class="warn" role="alert">{tr('imageExport.sizeDiffers', { w: states.width, h: states.height })}</p>{/if}
    <p class="dim">{tr('imageExport.note')}</p>
  </section>
  <section class="pre" aria-label={tr('preflight.panelTitle')}>
    <span class="label">{tr('preflight.panelTitle')}</span>
    {#if preBusy && !pre}<p class="dim" role="status">{tr('preflight.running')}</p>{/if}
    {#if preError}<p class="warn" role="alert">{preError}</p>{/if}
    {#if pre}
      <div class="row">
        <span role="status" class:warn={pre.counts.error > 0}>{tr('preflight.summary', { n: pre.checked, errors: pre.counts.error, warnings: pre.counts.warning, info: pre.counts.info })}</span>
        <button type="button" on:click={() => (preOpen = !preOpen)} aria-expanded={preOpen}>{preOpen ? tr('preflight.hide') : tr('preflight.show')}</button>
        <button type="button" on:click={refreshPreflight} disabled={preBusy}>{tr('preflight.run')}</button>
      </div>
      {#if preOpen}<div class="list"><PreflightList result={pre} on:show={e => dispatch('show', e.detail)} /></div>{/if}
      {#if pre.counts.error > 0}
        <p class="warn" role="alert">{tr('preflight.errorsBlock')}</p>
        <label class="row"><input type="checkbox" bind:checked={exportAnyway} /> {tr('preflight.exportAnyway')}</label>
      {/if}
    {/if}
  </section>
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 12px; }
  section { display: flex; flex-direction: column; gap: 6px; }
  .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--color-text-dim); }
  .row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
  .fl { min-width: 110px; color: var(--color-text-dim); }
  .dim { color: var(--color-text-dim); font-size: 11px; margin: 0; }
  .list { max-height: 220px; overflow: auto; }
  .warn { color: var(--color-warning-text); font-size: 12px; margin: 0; }
</style>
