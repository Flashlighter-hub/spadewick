<script>
  import { askConfirm } from '../stores/prompt.js'
  // names of file formats and colour models: the same in every language
  const NAMES = { png: 'PNG', jpeg: 'JPEG', cmyk: 'CMYK', rgb: 'RGB', x4: 'PDF/X-4', x1a: 'PDF/X-1a', url: 'https://' }
  /**
   * Manufacturer presets (PRD §18.2): the ones that ship (read only) and the person's own. A preset can be duplicated, changed,
   * exported to a file, imported from a file and removed (its own copies only).
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import Modal from './Modal.svelte'
  import { toast } from '../stores/ui.js'
  import { VERIFIABLE } from '../../../shared/presets.js'
  import { CARD_SIZES } from '../../../shared/cardSizes.js'

  const dispatch = createEventDispatcher()
  let presets = [], problems = []
  let editing = null          // a copy of the user's preset being edited
  let error = ''

  async function load() { const r = await window.spadewick.presets.list(); presets = r.presets; problems = r.problems }
  onMount(load)

  const num = v => (v === '' || v === null || v === undefined ? null : Number(v))

  async function duplicate(p) {
    error = ''
    try { const c = await window.spadewick.presets.duplicate({ id: p.id }); await load(); edit(presets.find(x => x.id === c.id)) } catch (err) { error = err.message }
  }
  function edit(p) {
    editing = structuredClone(p)
    editing.deck ??= {}
    editing.minimums ??= {}
    editing.rules ??= {}
    editing.sizesText = (p.sizes ?? []).join(', ')
  }
  async function save() {
    error = ''
    try {
      const p = { ...editing }
      p.sizes = p.sizesText.trim() ? p.sizesText.split(',').map(s => s.trim()).filter(Boolean) : null
      delete p.sizesText
      const d = p.deck
      p.deck = d.min || d.max || d.multiple ? { min: num(d.min) || undefined, max: num(d.max) || undefined, multiple: num(d.multiple) || undefined } : null
      if (p.deck) for (const k of ['min', 'max', 'multiple']) if (p.deck[k] === undefined) delete p.deck[k]
      p.bleedMm = Number(p.bleedMm); p.safeMm = Number(p.safeMm); p.dpi = Number(p.dpi); p.die.radiusMm = Number(p.die.radiusMm)
      if (p.rules.inkLimit === '' || p.rules.inkLimit === 0) delete p.rules.inkLimit; else if (p.rules.inkLimit) p.rules.inkLimit = Number(p.rules.inkLimit)
      p.minimums = Object.fromEntries(Object.entries(p.minimums).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => [k, Number(v)]))
      if (!p.guideUrl) p.guideUrl = null
      await window.spadewick.presets.save(p)
      toast(tr('presets.saved'), 'success', 2500)
      editing = null
      await load()
    } catch (err) { error = err.message }
  }
  async function remove(p) {
    if (!await askConfirm(tr('presets.confirmRemove', { name: p.name }))) return
    await window.spadewick.presets.remove(p.id)
    if (editing?.id === p.id) editing = null
    await load()
  }
  async function exportPreset(p) { error = ''; try { await window.spadewick.presets.export({ id: p.id }) } catch (err) { error = err.message } }
  async function importPreset() {
    error = ''
    try { const p = await window.spadewick.presets.import({}); if (p) { toast(tr('presets.imported', { name: p.name }), 'success', 3000); await load() } } catch (err) { error = err.message }
  }
  const kindLabel = k => (k === 'pdf' ? tr('presets.kindPdf') : k === 'images' ? tr('presets.kindImages') : tr('presets.kindBoth'))
  const fieldName = f => ({ bleed: tr('presets.fBleed'), safe: tr('presets.fSafe'), dpi: tr('presets.fDpi'), colour: tr('presets.fColour'), profile: tr('presets.fProfile'), standard: tr('presets.fStandard'), die: tr('presets.fDie'), deck: tr('presets.fDeck'), sizes: tr('presets.fSizes'), pixels: tr('presets.fPixels') }[f] ?? f)
</script>

<Modal title={tr('presets.title')} width={900} on:close={() => dispatch('close')}>
  <p class="help">{tr('presets.intro')}</p>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  {#if problems.length}<p class="warn">{tr('presets.problems', { n: problems.length })}</p>{/if}
  <table aria-label={tr('presets.title')}>
    <thead><tr><th scope="col">{tr('presets.colName')}</th><th scope="col">{tr('presets.colOutput')}</th><th scope="col">{tr('presets.colSettings')}</th><th scope="col">{tr('presets.colChecked')}</th><th scope="col"><span class="sr-only">{tr('presets.colActions')}</span></th></tr></thead>
    <tbody>
      {#each presets as p (p.id)}
        <tr>
          <td>{p.name}<div class="dim">{p.shipped ? p.manufacturer : tr('presets.mineLabel')}{#if p.basedOn} · {tr('presets.basedOn', { id: p.basedOn })}{/if}</div></td>
          <td>{kindLabel(p.kind)}</td>
          <td class="dim">{tr('presets.summary', { bleed: p.bleedMm, safe: p.safeMm, dpi: p.dpi })}</td>
          <td class="dim">{p.checkedOn}{#if p.stale} <strong class="warn">{tr('presets.recheck')}</strong>{/if}<div>{p.proofTested ? tr('presets.tested') : tr('presets.notTestedShort')}</div></td>
          <td class="actions">
            <button type="button" on:click={() => duplicate(p)} aria-label={tr('presets.duplicateOf', { name: p.name })}>{tr('presets.duplicate')}</button>
            {#if !p.shipped}<button type="button" on:click={() => edit(p)} aria-label={tr('presets.editOf', { name: p.name })}>{tr('presets.edit')}</button>
              <button type="button" on:click={() => remove(p)} aria-label={tr('presets.removeOf', { name: p.name })}>{tr('common.delete')}</button>{/if}
            <button type="button" on:click={() => exportPreset(p)} aria-label={tr('presets.exportOf', { name: p.name })}>{tr('presets.export')}</button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if editing}
    <form class="edit" on:submit|preventDefault={save} aria-label={tr('presets.editTitle', { name: editing.name })}>
      <h3>{tr('presets.editTitle', { name: editing.name })}</h3>
      <div class="grid">
        <label>{tr('presets.fName')} <input class="field" bind:value={editing.name} /></label>
        <label>{tr('presets.fManufacturer')} <input class="field" bind:value={editing.manufacturer} /></label>
        <label>{tr('presets.fGuide')} <input class="field" bind:value={editing.guideUrl} placeholder={NAMES.url} /></label>
        <label>{tr('presets.fOutput')}
          <select bind:value={editing.kind}><option value="pdf">{tr('presets.kindPdf')}</option><option value="images">{tr('presets.kindImages')}</option><option value="both">{tr('presets.kindBoth')}</option></select></label>
        <label>{tr('presets.fSizesList')} <input class="field" bind:value={editing.sizesText} placeholder={CARD_SIZES.map(s => s.id).slice(0, 3).join(', ')} /></label>
        <label>{tr('presets.fBleedMm')} <input type="number" step="0.025" min="0" max="20" bind:value={editing.bleedMm} /></label>
        <label>{tr('presets.fSafeMm')} <input type="number" step="0.025" min="0" max="20" bind:value={editing.safeMm} /></label>
        <label>{tr('presets.fDpi')} <input type="number" step="1" min="72" max="1200" bind:value={editing.dpi} /></label>
        <label>{tr('presets.fColour')}
          <select bind:value={editing.colour}><option value="cmyk">{NAMES.cmyk}</option><option value="rgb">{NAMES.rgb}</option><option value="either">{tr('presets.either')}</option></select></label>
        <label>{tr('presets.fStandard')}
          <select bind:value={editing.standard}><option value="x4">{NAMES.x4}</option><option value="x1a">{NAMES.x1a}</option><option value="plain">{tr('presets.plain')}</option></select></label>
        <label>{tr('presets.fProfile')} <input class="field" bind:value={editing.profileHint} placeholder={tr('presets.profilePlaceholder')} /></label>
        <label>{tr('presets.fImageFormat')}
          <select bind:value={editing.imageFormat}><option value="png">{NAMES.png}</option><option value="jpeg">{NAMES.jpeg}</option></select></label>
        <label>{tr('presets.fDie')}
          <select bind:value={editing.die.mode}><option value="none">{tr('presets.dieNone')}</option><option value="spot">{tr('presets.dieSpot')}</option><option value="layer">{tr('presets.dieLayer')}</option><option value="both">{tr('presets.dieBoth')}</option></select></label>
        <label>{tr('presets.fDieName')} <input class="field" bind:value={editing.die.spotName} /></label>
        <label>{tr('presets.fDieRadius')} <input type="number" step="0.025" min="0" max="15" bind:value={editing.die.radiusMm} /></label>
        <label>{tr('presets.fInkLimit')} <input type="number" step="5" min="100" max="400" bind:value={editing.rules.inkLimit} /></label>
        <label>{tr('presets.fDeckMin')} <input type="number" min="1" bind:value={editing.deck.min} /></label>
        <label>{tr('presets.fDeckMax')} <input type="number" min="1" bind:value={editing.deck.max} /></label>
        <label>{tr('presets.fDeckMultiple')} <input type="number" min="1" bind:value={editing.deck.multiple} /></label>
        <label>{tr('presets.fMinText')} <input type="number" step="0.5" bind:value={editing.minimums.textPt} /></label>
        <label>{tr('presets.fMinReversed')} <input type="number" step="0.5" bind:value={editing.minimums.reversedTextPt} /></label>
        <label>{tr('presets.fMinStroke')} <input type="number" step="0.05" bind:value={editing.minimums.strokePt} /></label>
        <label>{tr('presets.fMinPpi')} <input type="number" step="10" bind:value={editing.minimums.ppiWarn} /></label>
      </div>
      <label class="wide">{tr('presets.fNotes')} <textarea rows="3" bind:value={editing.notes}></textarea></label>
      <fieldset class="verify">
        <legend>{tr('presets.fVerify')}</legend>
        {#each VERIFIABLE as f}<label class="inline"><input type="checkbox" checked={editing.verify.includes(f)} on:change={e => (editing.verify = e.target.checked ? [...editing.verify, f] : editing.verify.filter(x => x !== f))} /> {fieldName(f)}</label>{/each}
      </fieldset>
      <div class="row"><button type="submit" class="primary">{tr('common.save')}</button><button type="button" on:click={() => (editing = null)}>{tr('common.cancel')}</button></div>
    </form>
  {/if}

  <svelte:fragment slot="footer">
    <button type="button" on:click={importPreset}>{tr('presets.import')}</button>
    <span style="flex:1" />
    <button type="button" class="primary" on:click={() => dispatch('close')}>{tr('common.done')}</button>
  </svelte:fragment>
</Modal>

<style>
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
  .dim { color: var(--color-text-dim); font-size: 11px; }
  .help { font-size: 12px; color: var(--color-text-dim); }
  .err { color: var(--color-danger-text); font-size: 12px; }
  .warn { color: var(--color-warning-text); font-size: 12px; }
  .actions { display: flex; gap: 4px; flex-wrap: wrap; }
  .edit { margin-top: 14px; border-top: 1px solid var(--color-border); padding-top: 10px; font-size: 11px; }
  .edit h3 { font-size: 13px; margin: 0 0 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
  .grid label, .wide { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-dim); }
  .wide { margin: 8px 0; }
  .verify { border: 1px solid var(--color-border); display: flex; gap: 12px; flex-wrap: wrap; margin: 8px 0; }
  .inline { display: flex; gap: 4px; align-items: center; color: var(--color-text); }
  .row { display: flex; gap: 8px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
