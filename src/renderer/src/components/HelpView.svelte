<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * The built-in guide (UPDATES U11), the Help tab: a quick start, a tour of the window and of each part of the application, every function and
   * operator of the formula language with what it does and an example that can be copied, and guides to template tokens, conditions, text
   * fitting, field types, rich text, exporting, the table, the rules pages, the command line and troubleshooting.
   * The list of functions comes from the formula language itself (shared/help.js), so the guide cannot fall behind it.
   */
  import { HELP_GROUPS, HELP_SECTIONS, HELP_ITEMS, HELP_EXAMPLES, HELP_FORMULA_FUNCTIONS, HELP_OPERATORS } from '../../../shared/help.js'
  import { HELP_SAMPLE } from '../../../main/formula.js'
  import { toast } from '../stores/ui.js'

  let section = HELP_SECTIONS[0]
  let query = ''
  let pageEl

  const card = { id: HELP_SAMPLE['@card.id'], number: HELP_SAMPLE['@card.number'], count: HELP_SAMPLE['@card.count'] }
  const sampleFields = Object.entries(HELP_SAMPLE).filter(([k]) => !k.startsWith('@'))

  /** One entry of the guide: { id, section, group, title, code, text, result, mono } */
  function buildEntries() {
    const out = []
    for (const key of HELP_ITEMS.formulas) out.push({ id: `formulas-${key}`, section: 'formulas', group: 'basics', title: tr(`help.items.formulas.${key}.title`), code: tr(`help.items.formulas.${key}.code`), text: tr(`help.items.formulas.${key}.text`), result: '' })
    for (const [group, names] of Object.entries(HELP_FORMULA_FUNCTIONS)) {
      for (const name of names) out.push({ id: `fn-${name}`, section: 'formulas', group, mono: true, title: tr(`help.fn.${name}.sig`), code: tr(`help.fn.${name}.example`), text: tr(`help.fn.${name}.does`), result: tr(`help.fn.${name}.result`) })
    }
    for (const op of HELP_OPERATORS) out.push({ id: `op-${op}`, section: 'formulas', group: 'operators', mono: true, title: op, code: tr(`help.ops.${op}.example`), text: tr(`help.ops.${op}.does`), result: tr(`help.ops.${op}.result`) })
    for (const name of HELP_EXAMPLES) out.push({ id: `ex-${name}`, section: 'formulas', group: 'examples', title: tr(`help.examples.${name}.title`), code: tr(`help.examples.${name}.formula`), text: tr(`help.examples.${name}.text`), result: tr(`help.examples.${name}.result`) })
    for (const [sec, keys] of Object.entries(HELP_ITEMS)) {
      if (sec === 'formulas') continue
      for (const key of keys) out.push({ id: `${sec}-${key}`, section: sec, group: '', title: tr(`help.items.${sec}.${key}.title`), code: tr(`help.items.${sec}.${key}.code`), text: tr(`help.items.${sec}.${key}.text`), result: '' })
    }
    return out
  }
  const entries = buildEntries()

  $: needle = query.trim().toLowerCase()
  $: found = needle ? entries.filter(e => [e.title, e.code, e.text, e.result].join(' ').toLowerCase().includes(needle)) : []
  // what is shown: the matches of the search, or the chosen section
  $: shownSections = needle ? HELP_SECTIONS.filter(s => found.some(e => e.section === s)) : [section]
  const entriesOf = (sec, list) => list.filter(e => e.section === sec)
  const groupsOf = list => [...new Set(list.map(e => e.group))]

  async function copy(code) {
    try { await navigator.clipboard.writeText(code); toast(tr('help.copied'), 'info', 1500) } catch { /* the code stays selectable */ }
  }
  const intro = sec => tr(`help.items.${sec}.intro`)
  const groupTitle = g => (g === 'basics' ? tr('help.formulas.basicsTitle') : g === 'operators' ? tr('help.formulas.operatorsTitle') : g === 'examples' ? tr('help.formulas.examplesTitle') : g ? tr(`help.formulas.groups.${g}`) : '')
</script>

<div class="help">
  <header class="top">
    <h2>{tr('help.title')}</h2>
    <input type="search" bind:value={query} placeholder="{tr('help.search')}" aria-label="{tr('help.searchLabel')}" />
    {#if needle}<span class="count" role="status" aria-live="polite">{tr('help.matches', { n: found.length })}</span>{/if}
  </header>

  <div class="body">
    <nav class="nav" aria-label="{tr('help.title')}">
      {#each Object.entries(HELP_GROUPS) as [group, secs] (group)}
        <div class="group" role="group" aria-labelledby="help-group-{group}">
          <span class="group-title" id="help-group-{group}">{tr(`help.groups.${group}`)}</span>
          {#each secs as sec (sec)}
            <button class:active={!needle && section === sec} aria-current={!needle && section === sec ? 'true' : undefined} on:click={() => { query = ''; section = sec; pageEl?.scrollTo?.(0, 0) }}>{tr(`help.sections.${sec}`)}</button>
          {/each}
        </div>
      {/each}
    </nav>

    <div class="page" tabindex="-1" bind:this={pageEl}>
      {#if !needle}<p class="lead">{tr('help.intro')}</p>{/if}
      {#if needle && !found.length}
        <p class="dim">{tr('help.noMatch', { query })}</p>
      {/if}

      {#each shownSections as sec (sec)}
        <section aria-labelledby="help-{sec}">
          <h3 id="help-{sec}">{tr(`help.sections.${sec}`)}</h3>
          {#if !needle}<p class="intro">{intro(sec)}</p>{/if}

          {#if sec === 'formulas' && !needle}
            <div class="sample">
              <h4>{tr('help.formulas.sampleTitle')}</h4>
              <dl>
                {#each sampleFields as [slug, value]}<div><dt>{slug}</dt><dd>{value}</dd></div>{/each}
              </dl>
              <p class="dim">{tr('help.formulas.sampleCard', card)}</p>
            </div>
          {/if}

          {#each groupsOf(entriesOf(sec, needle ? found : entries)) as g (g)}
            {#if g}<h4>{groupTitle(g)}</h4>{/if}
            {#if g === 'operators' && !needle}<p class="dim">{tr('help.formulas.operatorsIntro')}</p>{/if}
            <ul class="entries">
              {#each entriesOf(sec, needle ? found : entries).filter(e => e.group === g) as e (e.id)}
                <li id="help-{e.id}">
                  <div class="head">
                    <strong class:mono={e.mono}>{e.title}</strong>
                    {#if e.code}<button class="copy" on:click={() => copy(e.code)} aria-label="{tr('help.copyLabel', { code: e.code })}">{tr('help.copy')}</button>{/if}
                  </div>
                  <p>{e.text}</p>
                  {#if e.code}
                    <p class="code"><code>{e.code}</code>{#if e.result} <span class="gives">{tr('help.result')}</span> <code class="res">{e.result}</code>{/if}</p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/each}

          {#if sec === 'formulas' && !needle}<p class="dim">{tr('help.formulas.showIfNote')}</p>{/if}
        </section>
      {/each}
    </div>
  </div>
</div>

<style>
  .help { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--color-bg); }
  .top { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
  .top h2 { margin: 0; font-size: 15px; }
  .top input { flex: 1; max-width: 420px; }
  .count { font-size: 12px; color: var(--color-text-dim); }
  .body { flex: 1; min-height: 0; display: flex; }
  .nav { width: 210px; flex: none; display: flex; flex-direction: column; gap: 2px; padding: 10px; border-right: 1px solid var(--color-border); overflow-y: auto; }
  .group { display: flex; flex-direction: column; gap: 2px; }
  .group + .group { margin-top: 10px; }
  .group-title { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--color-text-dim); padding: 2px 10px; }
  .nav button { text-align: left; background: none; border: 1px solid transparent; padding: 6px 10px; border-radius: var(--radius); color: var(--color-text-dim); }
  .nav button:hover { color: var(--color-text); background: var(--color-surface-2); }
  .nav button.active { color: var(--color-text); font-weight: 700; background: var(--color-surface-2); border-color: var(--color-control-border); }
  .page { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 24px 40px; outline: none; }
  h3 { margin: 6px 0 4px; font-size: 17px; }
  h4 { margin: 18px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--color-text-dim); }
  .lead { color: var(--color-text-dim); max-width: 70ch; margin: 0 0 6px; }
  .intro { max-width: 70ch; line-height: 1.5; }
  .dim { color: var(--color-text-dim); font-size: 12px; max-width: 70ch; }
  .sample { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 4px 12px 10px; margin: 10px 0; max-width: 70ch; }
  .sample dl { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0; }
  .sample dl div { display: flex; gap: 6px; }
  .sample dt { font-family: var(--font-mono); color: var(--color-text-dim); }
  .sample dd { margin: 0; font-family: var(--font-mono); white-space: pre; }
  .entries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-width: 80ch; }
  .entries li { border: 1px solid var(--color-border); border-radius: var(--radius); padding: 8px 12px; background: var(--color-surface); }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .mono, code { font-family: var(--font-mono); }
  .entries p { margin: 4px 0 0; line-height: 1.45; }
  .code { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
  code { background: var(--color-surface-2); border-radius: 4px; padding: 1px 6px; font-size: 12px; user-select: all; overflow-wrap: anywhere; }
  .gives { color: var(--color-text-dim); font-size: 12px; }
  .res { background: color-mix(in srgb, var(--color-accent) 14%, transparent); }
  .copy { font-size: 11px; padding: 1px 8px; }
</style>
