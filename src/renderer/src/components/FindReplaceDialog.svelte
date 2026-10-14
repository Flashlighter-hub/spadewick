<script>
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher } from 'svelte'
  import Modal from './Modal.svelte'
  import { project, activeSetId, loadSet } from '../stores/project.js'
  import { toast } from '../stores/ui.js'
  import { stripMarkup } from '../../../shared/richText.js'

  // The results list shows a Rich text field as the text it reads as (PRD §16.7); the search itself covered the markup
  const shown = (c, v) => (c.rich ? stripMarkup(v) : v)

  const dispatch = createEventDispatcher()

  let find = ''
  let replace = ''
  let isRegex = false
  let scope = 'active' // 'active' | 'all' | 'selected'
  let selectedSetIds = []
  let allFields = []      // [{ slug, name }] across the in-scope sets (text/number only)
  let fieldFilter = []    // empty = all fields
  let results = null      // preview rows
  let error = ''
  let busy = false

  $: sets = $project?.sets ?? []
  $: setIds = scope === 'all' ? sets.map(s => s.id)
            : scope === 'selected' ? selectedSetIds
            : [$activeSetId].filter(Boolean)
  $: loadFields(setIds)

  async function loadFields(ids) {
    const lists = await Promise.all(ids.map(id => window.spadewick.fields.list(id)))
    const seen = new Map()
    for (const f of lists.flat()) if (['text', 'number'].includes(f.type) && !seen.has(f.slug)) seen.set(f.slug, f.name)
    allFields = [...seen].map(([slug, name]) => ({ slug, name }))
    fieldFilter = fieldFilter.filter(s => seen.has(s))
  }

  function toggle(list, v) { return list.includes(v) ? list.filter(x => x !== v) : [...list, v] }

  function opts(previewOnly) {
    return { setIds, fieldSlugs: fieldFilter.length ? fieldFilter : null, find, replace, isRegex, previewOnly }
  }

  async function preview() {
    error = ''; results = null
    if (!find) return
    busy = true
    try { results = await window.spadewick.cards.findReplace(opts(true)) }
    catch (err) { error = `Invalid search: ${err.message}` }
    finally { busy = false }
  }

  async function commit() {
    if (!results?.length) return
    busy = true
    try {
      const applied = await window.spadewick.cards.findReplace(opts(false))
      await loadSet($activeSetId)
      toast(tr('findReplaceDialog.replacedToast', { n: applied.length }), 'info', 3000)
      dispatch('close')
    } catch (err) { error = err.message }
    finally { busy = false }
  }

  // Highlight the matched/replaced portion in the preview table
  function parts(value, needle) {
    if (!needle || isRegex) return [{ t: value, hit: false }]
    const out = []
    let i = 0
    for (let at = value.indexOf(needle); at !== -1; at = value.indexOf(needle, i)) {
      if (at > i) out.push({ t: value.slice(i, at), hit: false })
      out.push({ t: needle, hit: true }); i = at + needle.length
    }
    if (i < value.length) out.push({ t: value.slice(i), hit: false })
    return out
  }
</script>

<Modal title="{tr('findReplaceDialog.findAndReplace')}" width={720} on:close>
  <label class="row">{tr('findReplaceDialog.find')} <input bind:value={find} on:input={() => results = null} class="grow" /></label>
  <label class="row">{tr('findReplaceDialog.replaceWith')} <input bind:value={replace} on:input={() => results = null} class="grow" /></label>
  <label><input type="checkbox" bind:checked={isRegex} on:change={() => results = null} /> {tr('findReplaceDialog.regularExpressionUse')} <code>$1</code> {tr('findReplaceDialog.forBackReferences')}</label>

  <fieldset>
    <legend>{tr('findReplaceDialog.scope')}</legend>
    <label><input type="radio" bind:group={scope} value="active" on:change={() => results = null} /> {tr('findReplaceDialog.activeSet')}</label>
    <label><input type="radio" bind:group={scope} value="all" on:change={() => results = null} /> {tr('findReplaceDialog.allSets')}</label>
    <label><input type="radio" bind:group={scope} value="selected" on:change={() => results = null} /> {tr('findReplaceDialog.selectedSets')}</label>
    {#if scope === 'selected'}
      <div class="chips">
        {#each sets as s (s.id)}
          <label><input type="checkbox" checked={selectedSetIds.includes(s.id)} on:change={() => { selectedSetIds = toggle(selectedSetIds, s.id); results = null }} /> {s.name}</label>
        {/each}
      </div>
    {/if}
  </fieldset>

  <fieldset>
    <legend>{tr('common.fields')} <span class="dim">{tr('findReplaceDialog.noneCheckedAllTextAnd')}</span></legend>
    <div class="chips">
      {#each allFields as f (f.slug)}
        <label><input type="checkbox" checked={fieldFilter.includes(f.slug)} on:change={() => { fieldFilter = toggle(fieldFilter, f.slug); results = null }} /> {f.name}</label>
      {/each}
    </div>
  </fieldset>

  {#if error}<div class="err">{error}</div>{/if}

  {#if results}
    <div class="dim">{tr('findReplaceDialog.cardsMatch', { n: results.length })}</div>
    {#if results.length}
      <table>
        <thead><tr><th>{tr('findReplaceDialog.card')}</th><th>{tr('common.field')}</th><th>{tr('findReplaceDialog.before')}</th><th>{tr('findReplaceDialog.after')}</th></tr></thead>
        <tbody>
          {#each results.slice(0, 200) as r}
            {#each Object.entries(r.changes) as [slug, c]}
              <tr>
                <td>{r.displayName}</td><td>{slug}</td>
                <td>{#each parts(shown(c, c.from), find) as p}{#if p.hit}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</td>
                <td>{shown(c, c.to)}</td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
      {#if results.length > 200}<div class="dim">{tr('findReplaceDialog.showingTheFirst200Cards')}</div>{/if}
    {/if}
  {/if}

  <svelte:fragment slot="footer">
    <button on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
    <button on:click={preview} disabled={busy || !find || !setIds.length}>{tr('common.preview')}</button>
    <button class="primary" on:click={commit} disabled={busy || !results?.length}>{tr('findReplaceDialog.replaceCards', { n: results?.length ?? 0 })}</button>
  </svelte:fragment>
</Modal>

<style>
  .row { display: flex; align-items: center; gap: 8px; }
  .grow { flex: 1; }
  fieldset { border: 1px solid var(--color-border); padding: 6px 8px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
  legend { padding: 0 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px 12px; width: 100%; }
  .dim { color: var(--color-text-dim); }
  .err { color: var(--color-danger-text); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
  mark { background: color-mix(in srgb, var(--color-danger) 40%, transparent); color: inherit; }
  .primary { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
  .primary:disabled { opacity: .5; }
</style>
