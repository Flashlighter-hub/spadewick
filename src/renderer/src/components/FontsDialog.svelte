<script>
  import { askConfirm } from '../stores/prompt.js'
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher, onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import { toast } from '../stores/ui.js'
  import { project } from '../stores/project.js'

  const dispatch = createEventDispatcher()
  let fonts = []
  let usage = {}   // family -> template names that mention it

  async function reload() {
    window.dispatchEvent(new Event('spadewick:rerender'))
    fonts = await window.spadewick.fonts.list()
    const tpls = await window.spadewick.templates.list()
    const full = await Promise.all(tpls.map(t => window.spadewick.templates.get(t.id)))
    usage = {}
    for (const f of fonts) usage[f.family_name] = full.filter(t => t.svg_source.includes(f.family_name)).map(t => t.name)
  }
  let included = []   // the families that come with the application
  onMount(async () => { included = await window.spadewick.fonts.bundled().catch(() => []); await reload() })

  // Per project (PRD §16.2): text drawn from the real font outlines, or the earlier per-character estimate
  $: outlines = $project?.meta?.text_engine === 'outlines'
  async function setEngine(on) {
    try {
      const engine = await window.spadewick.projects.setTextEngine(on ? 'outlines' : 'estimate')
      project.update(p => ({ ...p, meta: { ...p.meta, text_engine: engine } }))
      window.dispatchEvent(new Event('spadewick:rerender'))
    } catch (err) { toast(err.message, 'error', 5000) }
  }

  async function importFonts() {
    try { await window.spadewick.fonts.import(); await reload() }
    catch (err) { toast(tr('fontsDialog.importFailed', { reason: err.message }), 'error', 5000) }
  }

  async function remove(f) {
    if (!await askConfirm(tr('fontsDialog.confirmRemove', { family: f.family_name, style: f.style }))) return
    await window.spadewick.fonts.delete(f.id); await reload()
  }
</script>

<Modal title="{tr('fontsDialog.manageFonts')}" width={560} on:close>
  <p class="dim">{tr('fontsDialog.fontsAreEmbeddedWhenCards')}</p>
  <label class="engine"><input type="checkbox" checked={outlines} on:change={e => setEngine(e.currentTarget.checked)} /> {tr('fontsDialog.drawTextFromOutlines')}</label>
  <p class="dim small">{tr('fontsDialog.drawTextFromOutlinesHint')}</p>
  <details class="included">
    <summary>{tr('fontsDialog.includedTitle', { n: included.length })}</summary>
    <p class="dim small">{tr('fontsDialog.includedHint')}</p>
    <p class="families">{included.join(' · ')}</p>
  </details>
  <table>
    <thead><tr><th scope="col">{tr('fontsDialog.family')}</th><th scope="col">{tr('common.style')}</th><th scope="col">{tr('fontsDialog.usedBy')}</th><th scope="col"><span class="sr-only">{tr('common.actions')}</span></th></tr></thead>
    <tbody>
      {#each fonts as f (f.id)}
        <tr>
          <td style="font-family:'{f.family_name}'">{f.family_name}</td><td>{f.style}</td>
          <td>{#if usage[f.family_name]?.length}{usage[f.family_name].join(', ')}{:else}<span class="warn">{tr('fontsDialog.unused')}</span>{/if}</td>
          <td><button on:click={() => remove(f)} aria-label="{tr('fontsDialog.remove', { family: f.family_name })}">🗑</button></td>
        </tr>
      {:else}
        <tr><td colspan="4" class="dim">{tr('fontsDialog.noFontsImported')}</td></tr>
      {/each}
    </tbody>
  </table>
  <svelte:fragment slot="footer"><button on:click={importFonts}>{tr('fontsDialog.importFonts')}</button><span style="flex:1" /><button on:click={() => dispatch('close')}>{tr('common.done')}</button></svelte:fragment>
</Modal>

<style>
  .included { margin: 6px 0; }
  .families { line-height: 1.6; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--color-border); }
  .dim { color: var(--color-text-dim); }
  .small { font-size: 12px; margin-top: 2px; }
  .engine { display: flex; gap: 6px; align-items: center; margin: 8px 0 0; }
  .warn { color: var(--color-danger-text); }
</style>
