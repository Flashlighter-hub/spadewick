<script>
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher, onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import { activeSetId, activeSet, project, fields, templates, cards, loadSet } from '../stores/project.js'
  import { toast } from '../stores/ui.js'

  /**
   * Template rules of a set (UPDATES U24): "cards where skill_type == 'P' use the passive template". The first rule that is true for a card and
   * names a template for that side decides it; a template chosen for a card itself comes before every rule; the set's default is the last resort.
   */
  const dispatch = createEventDispatcher()
  const close = () => dispatch('close')

  let rules = []
  let preview = null
  let saving = false
  let timer, seq = 0

  onMount(() => {
    try { rules = JSON.parse($activeSet?.template_rules ?? '[]').map(r => ({ when: r.when, front: r.front ?? '', back: r.back ?? '' })) } catch { rules = [] }
    refresh()
  })

  // the names a condition can use: the set's own fields and the built-in status and quantity
  $: tokens = [...$fields.map(f => f.slug), 'status', 'quantity']
  const blank = () => ({ when: '', front: '', back: '' })
  function change() { rules = rules; clearTimeout(timer); timer = setTimeout(refresh, 250) }
  async function refresh() {
    const mine = ++seq
    const result = await window.spadewick.sets.rulePreview({ setId: $activeSetId, rules: rules.map(r => ({ when: r.when, front: r.front || null, back: r.back || null })) }).catch(() => null)
    if (mine === seq) preview = result
  }
  const add = () => { rules = [...rules, blank()]; refresh() }
  const remove = i => { rules = rules.filter((_, j) => j !== i); refresh() }
  function move(i, by) {
    const j = i + by
    if (j < 0 || j >= rules.length) return
    const next = [...rules]; [next[i], next[j]] = [next[j], next[i]]
    rules = next; refresh()
  }

  async function save() {
    saving = true
    try {
      const updated = await window.spadewick.sets.update({ id: $activeSetId, templateRules: rules.filter(r => r.when.trim() || r.front || r.back).map(r => ({ when: r.when, front: r.front || null, back: r.back || null })) })
      project.update(p => ({ ...p, sets: p.sets.map(s => (s.id === updated.id ? updated : s)) }))
      await loadSet($activeSetId)
      toast(tr('templateRules.saved'), 'info', 2500)
      close()
    } catch (err) {
      toast(tr('templateRules.couldNotSave', { reason: err.message }), 'error', 6000)
    } finally { saving = false }
  }
</script>

<Modal title={tr('templateRules.title', { name: $activeSet?.name ?? '' })} width={860} on:close={close}>
  <p class="hint">{tr('templateRules.intro')}</p>
  <p class="hint">{tr('templateRules.example')}</p>
  {#if $fields.length}
    <p class="hint tokens">{tr('templateRules.fieldsYouCanUse')} {#each tokens as token (token)}<code>{token}</code> {/each}</p>
  {/if}

  {#if rules.length}
    <table aria-label="{tr('templateRules.rules')}">
      <thead>
        <tr>
          <th scope="col">{tr('templateRules.number')}</th>
          <th scope="col">{tr('templateRules.when')}</th>
          <th scope="col">{tr('templateRules.front')}</th>
          <th scope="col">{tr('templateRules.back')}</th>
          <th scope="col">{tr('templateRules.cards')}</th>
          <th scope="col"><span class="sr-only">{tr('templateRules.actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rules as r, i}
          <tr>
            <td>{i + 1}</td>
            <td>
              <input class="mono" bind:value={r.when} on:input={change} placeholder={tr('templateRules.placeholder')} aria-label="{tr('templateRules.conditionOf', { n: i + 1 })}" aria-invalid={preview?.errors?.[i] ? 'true' : undefined} />
              {#if preview?.errors?.[i]}<div class="error" role="alert">{preview.errors[i]}</div>{/if}
            </td>
            <td>
              <select bind:value={r.front} on:change={change} aria-label="{tr('templateRules.frontOf', { n: i + 1 })}">
                <option value="">{tr('templateRules.noChange')}</option>
                {#each $templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
              </select>
            </td>
            <td>
              <select bind:value={r.back} on:change={change} aria-label="{tr('templateRules.backOf', { n: i + 1 })}">
                <option value="">{tr('templateRules.noChange')}</option>
                {#each $templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
              </select>
            </td>
            <td class="count">{preview?.counts?.[i] ?? ''}</td>
            <td class="actions">
              <button on:click={() => move(i, -1)} disabled={i === 0} aria-label="{tr('templateRules.moveUp', { n: i + 1 })}">↑</button>
              <button on:click={() => move(i, 1)} disabled={i === rules.length - 1} aria-label="{tr('templateRules.moveDown', { n: i + 1 })}">↓</button>
              <button on:click={() => remove(i)} aria-label="{tr('templateRules.delete', { n: i + 1 })}">🗑</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="empty">{tr('templateRules.none')}</p>
  {/if}

  {#if preview}
    <p class="summary" role="status">
      {tr('templateRules.summary', { unmatched: preview.unmatched, own: preview.own })}
      {#if !$activeSet?.default_template_id && preview.unmatched}<span class="warn">{tr('templateRules.noDefault')}</span>{/if}
    </p>
  {/if}

  <svelte:fragment slot="footer">
    <button on:click={add}>{tr('templateRules.add')}</button>
    <span class="spacer" />
    <button on:click={close}>{tr('common.cancel')}</button>
    <button class="primary" on:click={save} disabled={saving}>{tr('common.save')}</button>
  </svelte:fragment>
</Modal>

<style>
  .hint { font-size: 11px; color: var(--color-text-dim); margin: 0 0 4px; }
  .tokens code { margin-right: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; padding: 3px 4px; vertical-align: top; }
  td input, td select { width: 100%; }
  .mono { font-family: var(--font-mono); }
  input[aria-invalid='true'] { border-color: var(--color-danger); }
  .error { color: var(--color-danger-text); font-size: 11px; }
  .count { text-align: right; color: var(--color-text-dim); width: 60px; }
  .actions { white-space: nowrap; }
  .empty { color: var(--color-text-dim); font-style: italic; }
  .summary { font-size: 12px; margin-top: 8px; }
  .warn { color: var(--color-danger-text); margin-left: 6px; }
  .spacer { flex: 1; }
  .primary { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
</style>
