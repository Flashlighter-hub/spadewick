<script>
  import { tr } from '../../../shared/i18n.js'
  import { askText, askConfirm } from '../stores/prompt.js'
  import { createEventDispatcher } from 'svelte'
  import Modal from './Modal.svelte'
  import { activeSetId, activeSet, project, fields, cards, loadSet } from '../stores/project.js'
  import { toast } from '../stores/ui.js'
  import RichText from './RichText.svelte'

  const dispatch = createEventDispatcher()
  import { FIELD_TYPES, isComputed, hasOptions, parseRules, optionsOf, lookupOf } from '../../../shared/fieldTypes.js'
  const TYPES = FIELD_TYPES
  const typeLabel = t => tr(`fieldManager.types.${t}`)
  const close = () => dispatch('close')

  async function save(field, patch) {
    try {
      await window.spadewick.fields.update({ id: field.id, ...patch })
      await loadSet($activeSetId)
    } catch (err) {
      toast(tr('fieldManager.couldNotUpdate', { reason: err.message }), 'error', 5000)
      await loadSet($activeSetId)
    }
  }

  // Changing between Text and Rich text changes what `*`, `_`, `~` and `{` mean: show the cards that would look different first (PRD §16.7)
  let convert = null // { field, type, impact }
  async function changeType(field, type, select) {
    if (type === field.type) return
    const between = ['text', 'rich_text'].includes(field.type) && ['text', 'rich_text'].includes(type)
    if (between) {
      const impact = await window.spadewick.fields.convertImpact({ id: field.id, type })
      if (impact.count > 0) { convert = { field, type, impact }; select.value = field.type; return }
    }
    await save(field, { type })
  }
  async function applyConvert() {
    const { field, type } = convert
    convert = null
    await save(field, { type })
  }

  async function renameSlug(field, slug) {
    slug = slug.trim()
    if (!slug || slug === field.slug) return
    if (!await askConfirm(tr('fieldManager.confirmRenameToken', { from: field.slug, to: slug }))) return
    await save(field, { slug })
  }

  // Which column names the cards, and which one identifies them (UPDATES U9, U10); "none" is a choice
  const STORED = f => !isComputed(f.type)

  // The settings of one field, opened under its row (UPDATES U22, U23): range and "required" for any, the allowed values of a Choice or Tags
  // field, and where a Lookup looks. They are kept in the field's validation column; a change is saved when it is made.
  let openId = null
  let otherSets = []          // [{ id, name }] the sets a lookup may look in
  let otherFields = []        // the fields of the set a lookup looks in
  async function toggleSettings(field) {
    openId = openId === field.id ? null : field.id
    if (openId && field.type === 'lookup') await loadLookupSet(lookupOf(field).set)
  }
  async function loadLookupSet(setId) {
    otherSets = $project?.sets ?? []
    otherFields = setId ? (await window.spadewick.fields.list(setId)).filter(STORED) : []
  }
  const rulesOf = f => parseRules(f.validation)
  /** Save one change to a field's settings, keeping the rest of them. */
  const saveRules = (field, change) => save(field, { validation: { ...rulesOf(field), ...change } })
  const optionLines = f => optionsOf(f).join('\n')
  async function fillOptions(field) {
    const found = await window.spadewick.fields.distinctValues({ id: field.id })
    if (!found.length) { toast(tr('fieldManager.noValuesYet'), 'info', 3000); return }
    await saveRules(field, { options: [...new Set([...optionsOf(field), ...found.map(v => v.value)])] })
  }
  async function chooseLookup(field, change) {
    const next = { ...lookupOf(field), ...change }
    if ('set' in change) { next.match = ''; next.show = ''; await loadLookupSet(change.set) }
    await saveRules(field, next)
  }
  async function chooseColumn(key, slug) {
    try {
      const updated = await window.spadewick.sets.update({ id: $activeSetId, [key]: slug || null })
      project.update(p => ({ ...p, sets: p.sets.map(s => (s.id === updated.id ? updated : s)) }))
      cards.set(await window.spadewick.cards.list($activeSetId))   // the names of the cards follow the choice
    } catch (err) { toast(tr('fieldManager.couldNotUpdate', { reason: err.message }), 'error', 5000) }
  }

  async function addField() {
    const name = await askText(tr('fieldManager.promptName'))
    if (!name?.trim()) return
    try {
      await window.spadewick.fields.create({ setId: $activeSetId, name: name.trim(), type: 'text' })
      await loadSet($activeSetId)
    } catch (err) { toast(tr('fieldManager.couldNotAdd', { reason: err.message }), 'error', 5000) }
  }

  async function removeField(field) {
    if (!await askConfirm(tr('fieldManager.confirmDelete', { name: field.name }))) return
    await window.spadewick.fields.delete(field.id)
    await loadSet($activeSetId)
  }
</script>

<Modal title="{tr('fieldManager.manageFields')}" width={820} on:close={close}>
  <p class="hint">{tr('fieldManager.aFieldS')} <b>{tr('fieldManager.name')}</b> {tr('fieldManager.isMatchedAgainstCsvJson')} <b>{tr('fieldManager.token')}</b> {tr('fieldManager.isThe')} <code>{'{{token}}'}</code> {tr('fieldManager.usedInTemplates')}</p>
  <div class="columns-of-set">
    <label>{tr('fieldManager.displayName')}
      <select value={$activeSet?.display_field ?? ''} on:change={e => chooseColumn('displayField', e.target.value)}>
        <option value="">{tr('common.none')}</option>
        {#each $fields.filter(STORED) as f (f.id)}<option value={f.slug}>{f.name}</option>{/each}
      </select>
    </label>
    <label>{tr('fieldManager.identifier')}
      <select value={$activeSet?.identifier_field ?? ''} on:change={e => chooseColumn('identifierField', e.target.value)}>
        <option value="">{tr('common.none')}</option>
        {#each $fields.filter(STORED) as f (f.id)}<option value={f.slug}>{f.name}</option>{/each}
      </select>
    </label>
    <label>{tr('fieldManager.statusMode')}
      <select value={$activeSet?.status_mode ?? 0} on:change={e => chooseColumn('statusMode', Number(e.target.value))}>
        <option value={0}>{tr('fieldManager.statusOff')}</option>
        <option value={1}>{tr('fieldManager.statusOn')}</option>
        <option value={2}>{tr('fieldManager.statusAndArt')}</option>
      </select>
    </label>
  </div>
  <p class="hint">{tr('fieldManager.columnsHelp')}</p>
  {#if convert}
    <section class="convert" aria-label="{tr('fieldManager.convertTitle', { name: convert.field.name, type: convert.type })}">
      <h3>{tr('fieldManager.convertTitle', { name: convert.field.name, type: convert.type })}</h3>
      <p>{tr('fieldManager.convertIntro', { n: convert.impact.count })}</p>
      <table>
        <thead><tr><th scope="col">{tr('fieldManager.convertCard')}</th><th scope="col">{tr('fieldManager.convertNow')}</th><th scope="col">{tr('fieldManager.convertAfter')}</th></tr></thead>
        <tbody>
          {#each convert.impact.cards as c (c.id)}
            <tr>
              <td>{c.name}</td>
              <td>{#if convert.field.type === 'rich_text'}<RichText text={c.text} />{:else}<span class="plain">{c.text}</span>{/if}</td>
              <td>{#if convert.type === 'rich_text'}<RichText text={c.text} />{:else}<span class="plain">{c.text}</span>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if convert.impact.count > convert.impact.cards.length}<p class="hint">{tr('fieldManager.convertMore', { n: convert.impact.count - convert.impact.cards.length })}</p>{/if}
      <div class="convert-actions"><button on:click={() => convert = null}>{tr('common.cancel')}</button><button class="primary" on:click={applyConvert}>{tr('fieldManager.convertApply')}</button></div>
    </section>
  {/if}
  <table aria-label="{tr('common.fields')}">
    <thead><tr><th scope="col">{tr('fieldManager.show')}</th><th scope="col">{tr('common.name')}</th><th scope="col">{tr('common.token')}</th><th scope="col">{tr('fieldManager.type')}</th><th scope="col">{tr('fieldManager.default')}</th><th scope="col">{tr('fieldManager.formula')}</th><th scope="col" title="{tr('fieldManager.spreadHint')}">{tr('fieldManager.spread')}</th><th scope="col"><span class="sr-only">{tr('fieldManager.settings')}</span></th><th scope="col"><span class="sr-only">{tr('common.delete')}</span></th></tr></thead>
    <tbody>
      {#each $fields as f (f.id)}
        <tr>
          <td><input type="checkbox" checked={!f.hidden} aria-label="{tr('fieldManager.showColumn', { name: f.name })}" on:change={e => save(f, { hidden: !e.target.checked })} /></td>
          <td><input aria-label="{tr('fieldManager.nameOfField', { name: f.name })}" value={f.name} on:change={e => save(f, { name: e.target.value.trim() || f.name })} /></td>
          <td><input class="mono" aria-label="{tr('fieldManager.tokenOfField', { name: f.name })}" value={f.slug} on:change={e => renameSlug(f, e.target.value)} /></td>
          <td>
            <select aria-label="{tr('fieldManager.typeOfField', { name: f.name })}" value={f.type} on:change={e => changeType(f, e.target.value, e.currentTarget)}>
              {#each TYPES as t}<option value={t}>{typeLabel(t)}</option>{/each}
            </select>
          </td>
          <td><input aria-label="{tr('fieldManager.defaultValueOfField', { name: f.name })}" value={f.default_value ?? ''} on:change={e => save(f, { defaultValue: e.target.value })} /></td>
          <td><input class="mono" aria-label="{tr('fieldManager.formulaOfField', { name: f.name })}" value={f.formula ?? ''} disabled={f.type !== 'formula'} on:change={e => save(f, { formula: e.target.value })} /></td>
          <td><input type="checkbox" checked={!!f.propagate} disabled={!$activeSet?.identifier_field || $activeSet.identifier_field === f.slug || isComputed(f.type)} aria-label="{tr('fieldManager.spreadField', { name: f.name })}" on:change={e => save(f, { propagate: e.target.checked })} /></td>
          <td><button on:click={() => toggleSettings(f)} aria-expanded={openId === f.id} title="{tr('fieldManager.settingsOf', { name: f.name })}" aria-label="{tr('fieldManager.settingsOf', { name: f.name })}">⚙</button></td>
          <td><button on:click={() => removeField(f)} aria-label="{tr('fieldManager.deleteField', { name: f.name })}">🗑</button></td>
        </tr>
        {#if openId === f.id}
          <tr class="settings-row">
            <td colspan="9">
              <div class="settings" role="group" aria-label="{tr('fieldManager.settingsOf', { name: f.name })}">
                <label class="inline"><input type="checkbox" checked={!!rulesOf(f).required} on:change={e => saveRules(f, { required: e.target.checked })} /> {tr('fieldManager.required')}</label>
                {#if f.type === 'number'}
                  <label class="inline">{tr('fieldManager.min')} <input class="narrow" type="number" step="any" value={rulesOf(f).min ?? ''} on:change={e => saveRules(f, { min: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                  <label class="inline">{tr('fieldManager.max')} <input class="narrow" type="number" step="any" value={rulesOf(f).max ?? ''} on:change={e => saveRules(f, { max: e.target.value === '' ? null : Number(e.target.value) })} /></label>
                {/if}
                {#if hasOptions(f.type)}
                  <label class="block">{f.type === 'tags' ? tr('fieldManager.tagList') : tr('fieldManager.choiceList')}
                    <textarea rows="5" value={optionLines(f)} on:change={e => saveRules(f, { options: e.target.value.split('\n') })} />
                  </label>
                  <button on:click={() => fillOptions(f)}>{tr('fieldManager.fillFromCards')}</button>
                  <span class="hint">{tr('fieldManager.optionsHint')}</span>
                {/if}
                {#if f.type === 'lookup'}
                  {@const lk = lookupOf(f)}
                  <label class="block">{tr('fieldManager.lookupFrom')}
                    <select value={lk.from} on:change={e => chooseLookup(f, { from: e.target.value })}>
                      <option value="">{tr('common.none')}</option>
                      {#each $fields.filter(x => STORED(x) && x.id !== f.id) as x (x.id)}<option value={x.slug}>{x.name}</option>{/each}
                    </select>
                  </label>
                  <label class="block">{tr('fieldManager.lookupSet')}
                    <select value={lk.set} on:change={e => chooseLookup(f, { set: e.target.value })}>
                      <option value="">{tr('common.none')}</option>
                      {#each $project?.sets ?? [] as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
                    </select>
                  </label>
                  <label class="block">{tr('fieldManager.lookupMatch')}
                    <select value={lk.match} on:change={e => chooseLookup(f, { match: e.target.value })}>
                      <option value="">{tr('fieldManager.lookupDisplay')}</option>
                      <option value="@id">{tr('fieldManager.lookupCardId')}</option>
                      {#each otherFields as x (x.id)}<option value={x.slug}>{x.name}</option>{/each}
                    </select>
                  </label>
                  <label class="block">{tr('fieldManager.lookupShow')}
                    <select value={lk.show} on:change={e => chooseLookup(f, { show: e.target.value })}>
                      <option value="">{tr('fieldManager.lookupDisplay')}</option>
                      <option value="@id">{tr('fieldManager.lookupCardId')}</option>
                      {#each otherFields as x (x.id)}<option value={x.slug}>{x.name}</option>{/each}
                    </select>
                  </label>
                  <span class="hint">{tr('fieldManager.lookupHint')}</span>
                {/if}
              </div>
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
  <svelte:fragment slot="footer"><button on:click={addField}>{tr('fieldManager.field')}</button><span class="spacer" /><button on:click={close}>{tr('common.done')}</button></svelte:fragment>
</Modal>

<style>
  .spacer { flex: 1; }
  .columns-of-set { display: flex; gap: 16px; margin-bottom: 4px; }
  .columns-of-set label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--color-text-dim); flex: 1; }
  .hint { font-size: 11px; color: var(--color-text-dim); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 2px 4px; }
  td input:not([type='checkbox']), td select { width: 100%; }
  .mono { font-family: var(--font-mono); }
  .convert { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 8px 12px; margin-bottom: 10px; max-height: 260px; overflow: auto; }
  .convert h3 { margin: 0 0 4px; font-size: 13px; }
  .convert-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
  .plain { white-space: pre-wrap; }
  .settings-row td { background: var(--color-surface-2); padding: 6px 10px; border-radius: var(--radius); }
  .settings { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-end; }
  .settings label.block { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--color-text-dim); min-width: 160px; }
  .settings label.inline { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .settings textarea { width: 260px; font: inherit; }
  .settings .narrow { width: 90px; }
</style>
