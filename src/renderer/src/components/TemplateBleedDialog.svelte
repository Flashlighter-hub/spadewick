<script>
  /**
   * The bleed of a template (PRD §17.4): the canvas includes it (and the trim and safe lines are drawn inside it), or the edge of
   * the card is carried into it when the file is made (mirrored), or the bleed is filled with a colour. A template of trim size can
   * be widened to include bleed here; the content keeps its place relative to the trim.
   */
  import { createEventDispatcher } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import Modal from './Modal.svelte'
  import { toast } from '../stores/ui.js'

  export let template
  export let cardSize          // { mmW, mmH } of the template (locked)
  export let dirty = false     // unsaved edits: the canvas cannot be widened until they are saved
  const dispatch = createEventDispatcher()

  let mode = template.bleed_mode ?? 'extend'
  let mm = template.bleed_mm > 0 ? template.bleed_mm : 3
  let color = template.bleed_color ?? '#ffffff'
  let error = ''
  let busy = false

  const vb = (() => { const m = /viewBox\s*=\s*"([^"]*)"/.exec(template.svg_source ?? ''); const v = m?.[1].trim().split(/[\s,]+/).map(Number); return v?.length === 4 ? v : null })()
  $: expectedRatio = (cardSize.mmW + (mode === 'included' ? 2 * mm : 0)) / (cardSize.mmH + (mode === 'included' ? 2 * mm : 0))
  $: shapeOk = !vb || Math.abs(vb[2] / vb[3] - expectedRatio) / expectedRatio < 0.01
  $: includedNow = template.bleed_mode === 'included' && template.bleed_mm > 0

  async function save() {
    busy = true; error = ''
    try {
      await window.spadewick.templates.update({ id: template.id, bleedMode: mode, bleedMm: mode === 'included' ? Number(mm) : 0, bleedColor: mode === 'fill' ? color : null })
      dispatch('saved')
    } catch (err) { error = err.message } finally { busy = false }
  }

  async function widen() {
    busy = true; error = ''
    try {
      await window.spadewick.templates.addBleed({ id: template.id, bleedMm: Number(mm) })
      toast(tr('templateBleed.widened', { mm }), 'success', 4000)
      dispatch('saved')
    } catch (err) { error = err.message } finally { busy = false }
  }
</script>

<Modal title={tr('templateBleed.title')} width={520} on:close={() => dispatch('close')}>
  <p class="help">{tr('templateBleed.intro')}</p>
  <fieldset>
    <legend>{tr('templateBleed.how')}</legend>
    <label><input type="radio" bind:group={mode} value="included" /> {tr('templateBleed.included')}</label>
    <label><input type="radio" bind:group={mode} value="extend" /> {tr('templateBleed.extend')}</label>
    <label><input type="radio" bind:group={mode} value="fill" /> {tr('templateBleed.fill')}</label>
  </fieldset>
  {#if mode === 'included'}
    <label class="row">{tr('templateBleed.amount')} <input type="number" min="0.5" max="20" step="0.1" bind:value={mm} /> {tr('common.mm')}</label>
    <p class="note">{tr('templateBleed.canvasShould', { w: Math.round((cardSize.mmW + 2 * mm) * 100) / 100, h: Math.round((cardSize.mmH + 2 * mm) * 100) / 100 })}</p>
    {#if !shapeOk}<p class="warn" role="alert">{tr('templateBleed.shapeWrong')}</p>{/if}
    {#if !includedNow}
      <button type="button" on:click={widen} disabled={busy || dirty}>{tr('templateBleed.widen')}</button>
      {#if dirty}<p class="dim">{tr('templateBleed.saveFirst')}</p>{/if}
    {/if}
  {:else if mode === 'fill'}
    <label class="row">{tr('templateBleed.colour')} <input type="color" bind:value={color} /></label>
  {/if}
  {#if error}<p class="warn" role="alert">{error}</p>{/if}
  <svelte:fragment slot="footer">
    <button type="button" on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
    <span style="flex:1" />
    <button type="button" class="primary" on:click={save} disabled={busy}>{tr('common.save')}</button>
  </svelte:fragment>
</Modal>

<style>
  .help, .note { font-size: 12px; color: var(--color-text-dim); }
  fieldset { border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 6px; margin: 8px 0; font-size: 12px; }
  .row { display: flex; align-items: center; gap: 8px; font-size: 12px; margin: 8px 0; }
  .row input[type=number] { width: 72px; }
  .warn { color: var(--color-danger-text); font-size: 12px; }
  .dim { color: var(--color-text-dim); font-size: 11px; }
</style>
