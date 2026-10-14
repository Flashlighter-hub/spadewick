<script>
  /**
   * The settings of the production export (PRD §17.3) with the proof preview (§17.5). The export dialog owns the selection of sets and
   * cards, the file name and the card back; this panel owns what makes the file a production file.
   */
  import { onMount, onDestroy, createEventDispatcher } from 'svelte'
  import PreflightList from './PreflightList.svelte'
  import PresetBar from './PresetBar.svelte'
  import { tr } from '../../../shared/i18n.js'
  import ProfilesDialog from './ProfilesDialog.svelte'
  import PrintColorsDialog from './PrintColorsDialog.svelte'
  import { toast } from '../stores/ui.js'

  export let exportAnyway = false   // the person insists on exporting although the preflight found errors
  export let selection = {}      // setIds, cardIds, filter, cardBack, ... from the dialog: what the proof is made for

  const dispatch = createEventDispatcher()

  const DEFAULTS = {
    standard: 'x4', colour: 'cmyk', profileId: 'bundled:crpc1', intent: 'relative', blackPoint: true, dpi: 300, bleedMm: 3, safeMm: 3,
    cropMarks: false, registrationMarks: false, marksMarginMm: 10, backLayout: 'separate', dieLine: 'none', dieSpotName: 'DieCut', dieRadiusMm: 3.175,
    inkLimit: 300, noInkLimit: false, usePrintColors: true, repeatCopies: false, presetId: '', imageCompression: 'lossless', jpegQuality: 90
  }
  let s = { ...DEFAULTS }
  let profiles = { bundled: [], imported: [] }
  let saved = []
  let savedName = ''
  let savedPick = ''
  let profilesOpen = false, colorsOpen = false
  let proof = null, proofBusy = false, proofError = '', showGamut = true, showGuides = true
  let timer, loaded = false
  let pre = null, preBusy = false, preError = '', preOpen = true
  let presetNotes = null, presetExtras = null, applied = null   // the chosen manufacturer preset (PRD §18.4)

  /** The options to send to the export: the panel's settings. */
  export function options() {
    const { noInkLimit, ...rest } = s
    return { ...rest, inkLimit: noInkLimit ? null : Number(s.inkLimit) }
  }

  async function loadProfiles() { profiles = await window.spadewick.profiles.list() }
  async function loadSaved() { saved = await window.spadewick.exportProfiles.list({ kind: 'production' }) }
  onMount(async () => {
    await Promise.all([loadProfiles(), loadSaved()])
    try { const last = await window.spadewick.settings.get('production_options'); if (last && typeof last === 'object') s = { ...DEFAULTS, ...last } } catch { /* the defaults are fine */ }
    if (![...profiles.bundled, ...profiles.imported].some(p => p.id === s.profileId)) s.profileId = profiles.defaultId
    if (s.presetId) {
      // a preset chosen earlier: its notes and rules are read again, the settings stay as they were
      try { const a = await window.spadewick.presets.apply({ id: s.presetId, setId: selection.setIds?.[0] }); keepPreset(a) } catch { s.presetId = '' }
    }
    loaded = true
    refreshProof()
    refreshPreflight()
  })
  onDestroy(() => clearTimeout(timer))

  // The proof follows the settings and the selection, a moment after the last change
  $: if (loaded) { JSON.stringify([s, selection.setIds, selection.cardIds, selection.filter]); schedule() }
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => { refreshProof(); refreshPreflight() }, 450)
    try { window.spadewick.settings.set('production_options', { ...s }) } catch { /* remembered only when it can be */ }
  }

  async function refreshProof() {
    if (!selection.setIds?.length) { proof = null; return }
    proofBusy = true; proofError = ''
    try {
      proof = await window.spadewick.production.proof({ ...options(), setIds: selection.setIds, cardIds: selection.cardIds, filter: selection.filter })
    } catch (err) { proofError = err.message; proof = null } finally { proofBusy = false }
  }

  function keepPreset(a) { presetNotes = a.notes; presetExtras = { minimums: a.minimums, deck: a.deck }; applied = a.options }
  function applyPreset(e) {
    const a = e.detail
    if (!a) { presetNotes = null; presetExtras = null; applied = null; s.presetId = ''; return }
    keepPreset(a)
    s = { ...s, ...a.options, noInkLimit: a.options.inkLimit === undefined ? s.noInkLimit : false }
  }
  $: modified = !!applied && Object.entries(applied).some(([k, v]) => k !== 'presetId' && s[k] !== v)

  /** The print preflight for these settings and this selection; the export dialog gates the export on its errors. */
  async function refreshPreflight() {
    if (!selection.setIds?.length) { pre = null; dispatch('preflight', null); return }
    preBusy = true; preError = ''
    try {
      pre = await window.spadewick.preflight.run({ ...options(), setIds: selection.setIds, cardIds: selection.cardIds, filter: selection.filter, cardBack: selection.cardBack, cardBackColor: selection.cardBackColor, cardBackAssetId: selection.cardBackAssetId,
        preset: s.presetId && presetNotes ? { name: presetNotes.name, sizeOk: presetNotes.sizeOk, sizes: presetNotes.sizes, size: presetNotes.size, profile: presetNotes.profile, verify: presetNotes.verify, needsVector: presetNotes.needsVector, deck: presetExtras?.deck } : undefined,
        minimums: s.presetId && presetExtras ? presetExtras.minimums : undefined })
      if (!pre.counts.error) exportAnyway = false
      dispatch('preflight', pre)
    } catch (err) { preError = err.message; pre = null; dispatch('preflight', null) } finally { preBusy = false }
  }

  // ---- saved settings ----
  function applySaved() {
    const p = saved.find(x => x.id === savedPick)
    if (!p) return
    s = { ...DEFAULTS, ...p.options, noInkLimit: p.options.inkLimit === null }
    if (p.options.inkLimit === null) s.inkLimit = 300
    savedName = p.name
  }
  async function saveSettings() {
    try {
      const p = await window.spadewick.exportProfiles.save({ name: savedName, kind: 'production', options: options() })
      await loadSaved(); savedPick = p.id
      toast(tr('production.savedToast', { name: p.name }), 'success', 2500)
    } catch (err) { toast(err.message, 'error', 5000) }
  }
  async function deleteSaved() {
    if (!savedPick) return
    await window.spadewick.exportProfiles.remove(savedPick)
    savedPick = ''; savedName = ''
    await loadSaved()
  }

  $: allProfiles = [...profiles.bundled, ...profiles.imported]
  $: wantsMarks = s.cropMarks || s.registrationMarks
  $: rgbBlocked = s.colour === 'rgb' && s.standard === 'x1a'
  const pct = v => Math.round(v * 10) / 10
</script>

<div class="panel">
  <PresetBar kind="pdf" setId={selection.setIds?.[0]} bind:presetId={s.presetId} notes={presetNotes} {modified} on:apply={applyPreset} />

  <section class="pre" aria-label={tr('preflight.panelTitle')}>
    <span class="label">{tr('preflight.panelTitle')}</span>
    {#if preBusy && !pre}<p class="dim" role="status">{tr('preflight.running')}</p>{/if}
    {#if preError}<p class="err" role="alert">{preError}</p>{/if}
    {#if pre}
      <div class="row">
        <span role="status" class:err={pre.counts.error > 0}>{tr('preflight.summary', { n: pre.checked, errors: pre.counts.error, warnings: pre.counts.warning, info: pre.counts.info })}</span>
        <button type="button" on:click={() => (preOpen = !preOpen)} aria-expanded={preOpen}>{preOpen ? tr('preflight.hide') : tr('preflight.show')}</button>
        <button type="button" on:click={refreshPreflight} disabled={preBusy}>{tr('preflight.run')}</button>
      </div>
      {#if preOpen}<div class="list"><PreflightList result={pre} on:show={e => dispatch('show', e.detail)} /></div>{/if}
      {#if pre.counts.error > 0}
        <p class="err" role="alert">{tr('preflight.errorsBlock')}</p>
        <label class="row"><input type="checkbox" bind:checked={exportAnyway} /> {tr('preflight.exportAnyway')}</label>
      {/if}
    {/if}
  </section>

  <section>
    <span class="label">{tr('production.saved')}</span>
    <div class="row">
      <select bind:value={savedPick} on:change={applySaved} aria-label={tr('production.savedList')}>
        <option value="">{tr('production.choose')}</option>
        {#each saved as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
      <input class="field" bind:value={savedName} placeholder={tr('production.savedName')} aria-label={tr('production.savedName')} />
      <button type="button" on:click={saveSettings} disabled={!savedName.trim()}>{tr('production.saveAs')}</button>
      <button type="button" on:click={deleteSaved} disabled={!savedPick}>{tr('common.delete')}</button>
    </div>
  </section>

  <section>
    <span class="label">{tr('production.standard')}</span>
    <div class="row">
      <label><input type="radio" bind:group={s.standard} value="x4" /> {tr('production.x4')}</label>
      <label><input type="radio" bind:group={s.standard} value="x1a" /> {tr('production.x1a')}</label>
      <label><input type="radio" bind:group={s.standard} value="plain" /> {tr('production.plain')}</label>
    </div>
    <p class="dim">{tr('production.standardNote')}</p>
  </section>

  <section>
    <span class="label">{tr('production.colour')}</span>
    <div class="row">
      <label><input type="radio" bind:group={s.colour} value="cmyk" /> {tr('production.convert')}</label>
      <label><input type="radio" bind:group={s.colour} value="rgb" /> {tr('production.keepRgb')}</label>
    </div>
    {#if rgbBlocked}<p class="err" role="alert">{tr('production.rgbNeedsX4')}</p>{/if}
    {#if s.colour === 'cmyk'}
      <div class="row"><label class="fl" for="prod-profile">{tr('production.profile')}</label>
        <select id="prod-profile" bind:value={s.profileId}>
          {#each allProfiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
        <button type="button" on:click={() => (profilesOpen = true)}>{tr('production.manageProfiles')}</button>
      </div>
      <div class="row"><label class="fl" for="prod-intent">{tr('production.intent')}</label>
        <select id="prod-intent" bind:value={s.intent}>
          <option value="relative">{tr('production.intentRelative')}</option>
          <option value="perceptual">{tr('production.intentPerceptual')}</option>
          <option value="saturation">{tr('production.intentSaturation')}</option>
          <option value="absolute">{tr('production.intentAbsolute')}</option>
        </select>
        <label><input type="checkbox" bind:checked={s.blackPoint} /> {tr('production.blackPoint')}</label>
      </div>
      <div class="row"><label class="fl" for="prod-ink">{tr('production.inkLimit')}</label>
        <input id="prod-ink" type="number" min="100" max="400" step="5" bind:value={s.inkLimit} disabled={s.noInkLimit} style="width:70px" /> %
        <label><input type="checkbox" bind:checked={s.noInkLimit} /> {tr('production.noInkLimit')}</label>
      </div>
      <div class="row">
        <label><input type="checkbox" bind:checked={s.usePrintColors} /> {tr('production.usePrintColors')}</label>
        <button type="button" on:click={() => (colorsOpen = true)}>{tr('production.managePrintColors')}</button>
      </div>
    {:else}
      <p class="dim">{tr('production.rgbNote')}</p>
    {/if}
    <div class="row"><label class="fl" for="prod-compression">{tr('production.imageCompression')}</label>
      <select id="prod-compression" bind:value={s.imageCompression}>
        <option value="lossless">{tr('production.compressionLossless')}</option>
        <option value="jpeg">{tr('production.compressionJpeg')}</option>
      </select>
      {#if s.imageCompression === 'jpeg'}
        <label>{tr('production.jpegQuality')} <input type="number" min="50" max="100" step="1" bind:value={s.jpegQuality} style="width:64px" /></label>
      {/if}
    </div>
  </section>

  <section>
    <span class="label">{tr('production.page')}</span>
    <label class="row"><span class="fl">{tr('production.dpi')}</span>
      <select bind:value={s.dpi}><option value={150}>150</option><option value={300}>300</option><option value={450}>450</option><option value={600}>600</option></select>
    </label>
    <label class="row"><span class="fl">{tr('production.bleed')}</span><input type="number" min="0" max="20" step="0.5" bind:value={s.bleedMm} style="width:70px" /> {tr('common.mm')}</label>
    <label class="row"><span class="fl">{tr('production.safe')}</span><input type="number" min="0" max="20" step="0.5" bind:value={s.safeMm} style="width:70px" /> {tr('common.mm')}</label>
    <div class="row">
      <label><input type="checkbox" bind:checked={s.cropMarks} /> {tr('production.cropMarks')}</label>
      <label><input type="checkbox" bind:checked={s.registrationMarks} /> {tr('production.registrationMarks')}</label>
      {#if wantsMarks}<label>{tr('production.marksMargin')} <input type="number" min="3" max="30" step="1" bind:value={s.marksMarginMm} style="width:60px" /> {tr('common.mm')}</label>{/if}
    </div>
    <label class="row"><span class="fl">{tr('production.dieLine')}</span>
      <select bind:value={s.dieLine}>
        <option value="none">{tr('production.dieNone')}</option>
        <option value="spot">{tr('production.dieSpot')}</option>
        <option value="layer">{tr('production.dieLayer')}</option>
        <option value="both">{tr('production.dieBoth')}</option>
      </select>
    </label>
    {#if s.dieLine !== 'none'}
      <div class="row">
        {#if s.dieLine === 'spot' || s.dieLine === 'both'}<label>{tr('production.dieName')} <input class="field" bind:value={s.dieSpotName} style="width:130px" /></label>{/if}
        <label>{tr('production.dieRadius')} <input type="number" min="0" max="15" step="0.025" bind:value={s.dieRadiusMm} style="width:70px" /> {tr('common.mm')}</label>
      </div>
    {/if}
    <label class="row"><span class="fl">{tr('production.backs')}</span>
      <select bind:value={s.backLayout}>
        <option value="separate">{tr('production.backsSeparate')}</option>
        <option value="after">{tr('production.backsAfter')}</option>
        <option value="interleaved">{tr('production.backsInterleaved')}</option>
        <option value="once">{tr('production.backsOnce')}</option>
      </select>
    </label>
    <label class="row"><input type="checkbox" bind:checked={s.repeatCopies} /> {tr('production.repeatCopies')}</label>
  </section>

  <section class="proof">
    <span class="label">{tr('production.proof')}</span>
    <div class="row">
      <label><input type="checkbox" bind:checked={showGamut} /> {tr('production.showGamut')}</label>
      <label><input type="checkbox" bind:checked={showGuides} /> {tr('production.showGuides')}</label>
      <button type="button" on:click={refreshProof} disabled={proofBusy}>{tr('production.updateProof')}</button>
    </div>
    {#if proofBusy}<p class="dim" role="status">{tr('production.proofBusy')}</p>{/if}
    {#if proofError}<p class="err" role="alert">{proofError}</p>{/if}
    {#if proof}
      <div class="stage" style="width:{proof.width}px;height:{proof.height}px" role="img" aria-label={tr('production.proofAlt', { card: proof.stats.card })}>
        <img src="data:image/png;base64,{proof.proof}" alt="" width={proof.width} height={proof.height} />
        {#if showGamut}<img class="over" src="data:image/png;base64,{proof.gamut}" alt="" width={proof.width} height={proof.height} />{/if}
        {#if showGuides}
          <span class="g trim" style="left:{proof.box.trim[0] * 100}%;top:{proof.box.trim[1] * 100}%;width:{proof.box.trim[2] * 100}%;height:{proof.box.trim[3] * 100}%"><em>{tr('production.guideTrim')}</em></span>
          <span class="g safe" style="left:{proof.box.safe[0] * 100}%;top:{proof.box.safe[1] * 100}%;width:{proof.box.safe[2] * 100}%;height:{proof.box.safe[3] * 100}%"><em>{tr('production.guideSafe')}</em></span>
        {/if}
      </div>
      <ul class="stats" aria-label={tr('production.proofStats')}>
        <li>{tr('production.statInk', { max: pct(proof.stats.maxInkPct) })}{#if proof.stats.inkLimit && proof.stats.maxInkPct > proof.stats.inkLimit} — {tr('production.statInkLimited', { limit: proof.stats.inkLimit })}{/if}</li>
        <li>{tr('production.statGamut', { pct: proof.stats.outOfRangePct })}</li>
        {#if proof.stats.printColorPixels}<li>{tr('production.statPrintColors', { n: proof.stats.printColorPixels })}</li>{/if}
        {#each Object.entries(proof.stats.spotPixels) as [name, n]}<li class="warn">{tr('production.statSpot', { name })}</li>{/each}
      </ul>
      <p class="dim">{tr('production.proofNote')}</p>
    {:else if !proofBusy && !proofError}
      <p class="dim">{tr('production.proofNone')}</p>
    {/if}
  </section>
</div>

{#if profilesOpen}<ProfilesDialog on:close={() => { profilesOpen = false; loadProfiles() }} on:changed={loadProfiles} />{/if}
{#if colorsOpen}<PrintColorsDialog on:close={() => { colorsOpen = false; schedule() }} on:changed={schedule} />{/if}

<style>
  .panel { display: flex; flex-direction: column; gap: 14px; }
  section { display: flex; flex-direction: column; gap: 6px; }
  .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--color-text-dim); }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; }
  .fl { min-width: 110px; color: var(--color-text-dim); }
  .dim { color: var(--color-text-dim); font-size: 11px; margin: 0; }
  .err { color: var(--color-danger-text); font-size: 12px; margin: 0; }
  .warn { color: var(--color-warning-text); }
  .field { min-width: 100px; }
  .stage { position: relative; max-width: 100%; border: 1px solid var(--color-border); background: #fff; }
  .stage img { display: block; position: absolute; left: 0; top: 0; }
  .stage .over { pointer-events: none; }
  .g { position: absolute; box-sizing: border-box; pointer-events: none; }
  .g em { position: absolute; left: 2px; top: 2px; font-style: normal; font-size: 10px; padding: 0 3px; color: #fff; }
  .g.trim { border: 1.5px dashed #c2255c; } .g.trim em { background: #c2255c; }
  .g.safe { border: 1.5px dashed #0b5cad; } .g.safe em { background: #0b5cad; top: auto; bottom: 2px; }
  .stats { margin: 4px 0; padding-left: 18px; font-size: 12px; }
  .list { max-height: 220px; overflow: auto; border: 1px solid var(--color-border); }
</style>
