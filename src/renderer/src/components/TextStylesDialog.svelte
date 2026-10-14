<script>
  import { askConfirm } from '../stores/prompt.js'
  /**
   * Text styles and keyword rules (PRD §16.5): named bundles of text properties, and rules that show a word the way a
   * style, an icon or other text says. Changing a style changes every card at once; rules are tried in order.
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import Modal from './Modal.svelte'
  import RichText from './RichText.svelte'
  import { iconLibrary, textStyles, keywordRules, loadTextLibrary } from '../stores/textLibrary.js'
  import { starterIconNames } from '../../../shared/starterIcons.js'
  import { toast } from '../stores/ui.js'

  const dispatch = createEventDispatcher()
  let tab = 'styles'
  let busy = false
  let fonts = [], richFields = []
  const BUNDLED = ['Liberation Serif', 'Liberation Sans', 'Liberation Mono'] // the fonts that come with the app
  const HEX_HINT = '#rrggbb'

  onMount(async () => {
    loadTextLibrary() // the styles and rules may have changed since they were loaded
    fonts = [...new Set([...(await window.spadewick.fonts.list()).map(f => f.family_name), ...(await window.spadewick.fonts.bundled())])].sort((a, b) => a.localeCompare(b))
    const slugs = new Map()
    for (const set of await window.spadewick.sets.list()) for (const f of await window.spadewick.fields.list(set.id)) if (f.type === 'rich_text') slugs.set(f.slug, f.name)
    richFields = [...slugs].map(([slug, name]) => ({ slug, name }))
  })

  async function changed() {
    await loadTextLibrary()
    window.dispatchEvent(new Event('spadewick:rerender'))
  }
  async function run(fn) {
    busy = true
    try { return await fn() } catch (err) { toast(err.message, 'error', 6000); await loadTextLibrary() } finally { busy = false }
  }

  // ---------------------------------------------------------------- styles
  let selectedId = null
  $: selected = $textStyles.find(s => s.id === selectedId) ?? null
  let form = {}, renameText = ''
  // The form is filled when another style is chosen, and after its own save, not from a reload another change caused
  let syncedId = null
  $: if (selected && selected.id !== syncedId) { syncedId = selected.id; form = { ...selected.props }; renameText = selected.name }
  $: if (!selected) syncedId = null

  const FLAGS = ['bold', 'italic', 'underline', 'strike', 'smallCaps']
  const flagLabel = { bold: () => tr('textStyles.bold'), italic: () => tr('textStyles.italic'), underline: () => tr('textStyles.underline'), strike: () => tr('textStyles.strike'), smallCaps: () => tr('textStyles.smallCaps') }

  async function newStyle() {
    const base = 'style'
    let n = 1
    while ($textStyles.some(s => s.name === `${base}-${n}`)) n++
    await run(async () => { const s = await window.spadewick.textStyles.create({ name: `${base}-${n}`, props: { bold: true } }); await changed(); selectedId = s.id })
  }

  /** Save the form as the style's properties; a field left empty is simply not part of the style. */
  const save = () => run(async () => {
    const props = { ...form }
    for (const k of ['size', 'tracking', 'outlineWidth', 'shadowX', 'shadowY']) { const v = props[k]; props[k] = v === '' || v == null ? null : Number(v) }
    await window.spadewick.textStyles.update({ id: selected.id, props })
    await changed()
    const now = $textStyles.find(s => s.id === syncedId)
    if (now) form = { ...now.props }
  })
  const setFlag = (k, on) => { form = { ...form, [k]: on || null }; save() }

  async function renameStyle() {
    const name = renameText.trim()
    if (!selected || !name || name === selected.name) { renameText = selected?.name ?? ''; return }
    await run(async () => {
      const res = await window.spadewick.textStyles.rename({ id: selected.id, name })
      await changed()
      toast(tr('textStyles.renamed', { cards: res.updated.cards, rules: res.updated.rules, templates: res.updated.templates }), 'info', 4000)
    })
  }

  async function removeStyle() {
    const u = selected.usage
    if (!await askConfirm(u.cards || u.rules ? tr('textStyles.confirmDeleteUsed', { name: selected.name, cards: u.cards, rules: u.rules }) : tr('textStyles.confirmDelete', { name: selected.name }))) return
    const id = selected.id; selectedId = null
    await run(async () => { await window.spadewick.textStyles.remove(id); await changed() })
  }

  // ---------------------------------------------------------------- keywords
  let sample = 'Flying creatures with Haste. Flying again.'
  const iconNames = () => [...new Set([...$iconLibrary.icons.map(i => i.name), ...starterIconNames()])]

  async function addRule() {
    await run(async () => {
      await window.spadewick.keywords.create({ match: 'Flying', mode: 'style', action: { style: $textStyles[0]?.name ?? 'keyword' } })
      await changed()
    })
  }
  const patchRule = (rule, patch) => run(async () => { await window.spadewick.keywords.update({ id: rule.id, ...patch }); await changed() })
  const setMode = (rule, mode) => patchRule(rule, { mode, action: mode === 'style' ? { style: $textStyles[0]?.name ?? 'keyword' } : mode === 'replace' ? { text: '' } : { icon: iconNames()[0] } })
  const removeRule = rule => run(async () => { await window.spadewick.keywords.remove(rule.id); await changed() })
  async function move(rule, by) {
    const ids = $keywordRules.map(r => r.id)
    const i = ids.indexOf(rule.id), j = i + by
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await run(async () => { await window.spadewick.keywords.reorder(ids); await changed() })
  }
  const toggleScope = (rule, slug, on) => patchRule(rule, { scope: [...new Set([...(rule.scope ?? []).filter(s => s !== slug), ...(on ? [slug] : [])])] })
</script>

<Modal title={tr('textStyles.title')} width={960} on:close={() => dispatch('close')}>
  <div class="tabs" role="tablist" aria-label={tr('textStyles.title')}>
    <button role="tab" id="tab-styles" aria-selected={tab === 'styles'} aria-controls="panel-styles" class:on={tab === 'styles'} on:click={() => tab = 'styles'}>{tr('textStyles.tabStyles', { n: $textStyles.length })}</button>
    <button role="tab" id="tab-keywords" aria-selected={tab === 'keywords'} aria-controls="panel-keywords" class:on={tab === 'keywords'} on:click={() => tab = 'keywords'}>{tr('textStyles.tabKeywords', { n: $keywordRules.length })}</button>
  </div>

  {#if tab === 'styles'}
    <div class="body" role="tabpanel" id="panel-styles" aria-labelledby="tab-styles">
      <div class="list">
        <button on:click={newStyle} disabled={busy}>{tr('textStyles.newStyle')}</button>
        <ul aria-label={tr('textStyles.stylesList')}>
          {#each $textStyles as s (s.id)}
            <li><button class="item" class:sel={s.id === selectedId} aria-pressed={s.id === selectedId} on:click={() => selectedId = s.id}>
              <span class="sample"><RichText text={`{style:${s.name}}${s.name}{/style}`} inline /></span>
            </button></li>
          {:else}<li class="dim">{tr('textStyles.noStyles')}</li>{/each}
        </ul>
      </div>
      {#if selected}
        <section class="form" aria-label={tr('textStyles.settings', { name: selected.name })}>
          <label>{tr('textStyles.name')} <span class="inline"><input bind:value={renameText} on:keydown={e => e.key === 'Enter' && renameStyle()} /><button on:click={renameStyle} disabled={busy}>{tr('textStyles.rename')}</button></span></label>
          <fieldset><legend>{tr('textStyles.look')}</legend>
            <div class="flags">{#each FLAGS as k}<label class="check"><input type="checkbox" checked={!!form[k]} on:change={e => setFlag(k, e.currentTarget.checked)} /> {flagLabel[k]()}</label>{/each}</div>
            <div class="grid2">
              <label>{tr('textStyles.font')}
                <select value={form.fontFamily ?? ''} on:change={e => { form = { ...form, fontFamily: e.currentTarget.value || null }; save() }}>
                  <option value="">{tr('textStyles.inherit')}</option>
                  {#each fonts as f}<option value={f}>{f}</option>{/each}
                  {#each BUNDLED as f}{#if !fonts.includes(f)}<option value={f}>{f}</option>{/if}{/each}
                </select>
              </label>
              <label>{tr('textStyles.size')} <input type="number" min="0.1" max="5" step="0.05" value={form.size ?? ''} placeholder="1" on:change={e => { form = { ...form, size: e.currentTarget.value }; save() }} /></label>
              <label>{tr('textStyles.color')} <span class="inline"><input type="color" value={/^#[0-9a-f]{6}$/i.test(form.color ?? '') ? form.color : '#000000'} on:change={e => { form = { ...form, color: e.currentTarget.value }; save() }} /><input value={form.color ?? ''} placeholder={HEX_HINT} on:change={e => { form = { ...form, color: e.currentTarget.value || null }; save() }} /></span></label>
              <label>{tr('textStyles.tracking')} <input type="number" min="-100" max="500" step="5" value={form.tracking ?? ''} placeholder="0" on:change={e => { form = { ...form, tracking: e.currentTarget.value }; save() }} /></label>
            </div>
          </fieldset>
          <fieldset><legend>{tr('textStyles.effects')}</legend>
            <div class="grid2">
              <label>{tr('textStyles.outlineWidth')} <input type="number" min="0" max="0.3" step="0.01" value={form.outlineWidth ?? ''} on:change={e => { form = { ...form, outlineWidth: e.currentTarget.value }; save() }} /></label>
              <label>{tr('textStyles.outlineColor')} <input value={form.outlineColor ?? ''} placeholder={HEX_HINT} on:change={e => { form = { ...form, outlineColor: e.currentTarget.value || null }; save() }} /></label>
              <label>{tr('textStyles.shadowX')} <input type="number" min="-1" max="1" step="0.01" value={form.shadowX ?? ''} on:change={e => { form = { ...form, shadowX: e.currentTarget.value }; save() }} /></label>
              <label>{tr('textStyles.shadowY')} <input type="number" min="-1" max="1" step="0.01" value={form.shadowY ?? ''} on:change={e => { form = { ...form, shadowY: e.currentTarget.value }; save() }} /></label>
              <label>{tr('textStyles.shadowColor')} <input value={form.shadowColor ?? ''} placeholder={HEX_HINT} on:change={e => { form = { ...form, shadowColor: e.currentTarget.value || null }; save() }} /></label>
            </div>
          </fieldset>
          <div class="preview" aria-label={tr('textStyles.preview')}><RichText text={`Some text with {style:${selected.name}}a styled word{/style} in it.`} /></div>
          <p class="dim">{tr('textStyles.usage', { cards: selected.usage.cards, rules: selected.usage.rules })}</p>
          <div class="actions"><button class="danger" on:click={removeStyle} disabled={busy}>{tr('textStyles.delete')}</button></div>
        </section>
      {/if}
    </div>
  {:else}
    <div class="body col" role="tabpanel" id="panel-keywords" aria-labelledby="tab-keywords">
      <p class="dim">{tr('textStyles.keywordsIntro')}</p>
      <div class="bar"><button on:click={addRule} disabled={busy}>{tr('textStyles.addRule')}</button>
        <label class="inline grow">{tr('textStyles.sample')} <input bind:value={sample} /></label></div>
      <ol class="rules" aria-label={tr('textStyles.rulesList')}>
        {#each $keywordRules as r, i (r.id)}
          <li class="rule" aria-label={tr('textStyles.ruleLabel', { n: i + 1, match: r.match })}>
            <div class="row">
              <label class="check"><input type="checkbox" checked={r.enabled} on:change={e => patchRule(r, { enabled: e.currentTarget.checked })} /> {tr('textStyles.enabled')}</label>
              <label>{tr('textStyles.whenTextContains')} <input value={r.match} on:change={e => patchRule(r, { match: e.currentTarget.value })} /></label>
              <label class="check"><input type="checkbox" checked={r.wholeWord} on:change={e => patchRule(r, { wholeWord: e.currentTarget.checked })} /> {tr('textStyles.wholeWord')}</label>
              <label class="check"><input type="checkbox" checked={r.ignoreCase} on:change={e => patchRule(r, { ignoreCase: e.currentTarget.checked })} /> {tr('textStyles.ignoreCase')}</label>
              <label class="check"><input type="checkbox" checked={r.isPattern} on:change={e => patchRule(r, { isPattern: e.currentTarget.checked })} /> {tr('textStyles.isPattern')}</label>
            </div>
            <div class="row">
              <label>{tr('textStyles.showAs')}
                <select value={r.mode} on:change={e => setMode(r, e.currentTarget.value)}>
                  <option value="style">{tr('textStyles.modeStyle')}</option><option value="icon">{tr('textStyles.modeIcon')}</option>
                  <option value="icon_text">{tr('textStyles.modeIconText')}</option><option value="replace">{tr('textStyles.modeReplace')}</option>
                </select>
              </label>
              {#if r.mode === 'style'}
                <label>{tr('textStyles.style')}
                  <select value={r.action.style} on:change={e => patchRule(r, { action: { style: e.currentTarget.value } })}>
                    {#each $textStyles as s}<option value={s.name}>{s.name}</option>{/each}
                    {#if !$textStyles.some(s => s.name === r.action.style)}<option value={r.action.style}>{tr('textStyles.missingStyle', { name: r.action.style })}</option>{/if}
                  </select>
                </label>
              {:else if r.mode === 'replace'}
                <label>{tr('textStyles.replacement')} <input value={r.action.text ?? ''} on:change={e => patchRule(r, { action: { text: e.currentTarget.value } })} /></label>
              {:else}
                <label>{tr('textStyles.icon')}
                  <select value={r.action.icon} on:change={e => patchRule(r, { action: { icon: e.currentTarget.value } })}>
                    {#each iconNames() as n}<option value={n}>{n}</option>{/each}
                    {#if !iconNames().includes(r.action.icon)}<option value={r.action.icon}>{tr('textStyles.missingIcon', { name: r.action.icon })}</option>{/if}
                  </select>
                </label>
              {/if}
              <label>{tr('textStyles.appliesTo')}
                <select value={r.scope ? 'some' : 'all'} on:change={e => patchRule(r, { scope: e.currentTarget.value === 'all' ? null : richFields.slice(0, 1).map(f => f.slug) })}>
                  <option value="all">{tr('textStyles.allRichText')}</option><option value="some">{tr('textStyles.chosenFields')}</option>
                </select>
              </label>
            </div>
            {#if r.scope}
              <div class="row" role="group" aria-label={tr('textStyles.chosenFields')}>
                {#each richFields as f}<label class="check"><input type="checkbox" checked={r.scope.includes(f.slug)} on:change={e => toggleScope(r, f.slug, e.currentTarget.checked)} /> {f.name}</label>{:else}<span class="dim">{tr('textStyles.noRichFields')}</span>{/each}
              </div>
            {/if}
            <div class="row between">
              <div class="preview" aria-label={tr('textStyles.preview')}><RichText text={sample} rules={[r]} /></div>
              <span class="inline"><button on:click={() => move(r, -1)} disabled={busy || i === 0} aria-label={tr('textStyles.moveUp', { match: r.match })}>↑</button><button on:click={() => move(r, 1)} disabled={busy || i === $keywordRules.length - 1} aria-label={tr('textStyles.moveDown', { match: r.match })}>↓</button><button class="danger" on:click={() => removeRule(r)} disabled={busy} aria-label={tr('textStyles.deleteRule', { match: r.match })}>🗑</button></span>
            </div>
          </li>
        {:else}<li class="dim">{tr('textStyles.noRules')}</li>{/each}
      </ol>
    </div>
  {/if}

  <svelte:fragment slot="footer"><span style="flex:1" /><button on:click={() => dispatch('close')}>{tr('common.done')}</button></svelte:fragment>
</Modal>

<style>
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-border); margin-bottom: 8px; }
  .tabs button { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .tabs button.on { background: var(--color-surface-hover, rgba(128,128,128,.2)); font-weight: 600; }
  .body { display: flex; gap: 14px; min-height: 320px; }
  .body.col { flex-direction: column; gap: 8px; }
  .list { width: 220px; display: flex; flex-direction: column; gap: 6px; }
  .list ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 340px; overflow: auto; }
  .item { width: 100%; text-align: left; }
  .item.sel { outline: 2px solid var(--color-accent, #4a8cff); }
  .form { flex: 1; display: flex; flex-direction: column; gap: 8px; }
  .form label, .rule label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--color-text-dim); }
  label.check { flex-direction: row; align-items: center; gap: 4px; color: inherit; }
  fieldset { border: 1px solid var(--color-border); border-radius: var(--radius); }
  .flags { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 12px; }
  .grid2 input:not([type='color']), .grid2 select { width: 100%; box-sizing: border-box; }
  .inline { display: flex; gap: 4px; align-items: center; }
  .inline.grow { flex: 1; } .inline.grow input { flex: 1; }
  .preview { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 6px 8px; min-height: 28px; background: var(--color-bg); font-size: 14px; flex: 1; }
  .dim { color: var(--color-text-dim); font-size: 12px; }
  .actions { display: flex; gap: 6px; }
  .danger { color: var(--color-danger-text); }
  .bar { display: flex; gap: 8px; align-items: center; }
  .rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow: auto; }
  .rule { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
  .row.between { justify-content: space-between; align-items: center; flex-wrap: nowrap; }
</style>
