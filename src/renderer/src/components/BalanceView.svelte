<script>
  import { tr } from '../../../shared/i18n.js'
  import { onMount, onDestroy } from 'svelte'
  import { activeSetId, activeSet } from '../stores/project.js'
  import { activeTab, focusCard } from '../stores/ui.js'
  import { PROJECT_CHANGED } from '../stores/projectChanges.js'

  /**
   * Balance and set statistics (UPDATES U22): counts by any field (a cost curve, a faction split, rarity), a summary of every field, and the
   * warnings a designer would otherwise look for by hand. Everything is worked out from the card table each time, so it is never out of date.
   */
  let by = ''
  let split = ''
  let copies = false
  let viewId = ''
  let unique = []
  let views = []
  let data = null
  let error = ''
  let seq = 0, timer
  let showAllWarnings = false

  const COLORS = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#9c755f', '#bab0ac', '#86bcb6']
  const colorOf = i => COLORS[i % COLORS.length]
  const labelOf = key => (key === '' ? tr('balance.empty') : key)

  $: setId = $activeSetId
  $: if (setId) { by = ''; split = ''; viewId = ''; unique = []; loadViews(setId) }
  $: filter = views.find(v => v.id === viewId)?.filter ?? ''
  $: refreshSoon(setId, by, split, copies, filter, unique)

  async function loadViews(id) { views = await window.spadewick.views.list(id).catch(() => []) }

  function refreshSoon() {
    clearTimeout(timer)
    timer = setTimeout(refresh, 120)
  }
  async function refresh() {
    if (!setId) { data = null; return }
    const mine = ++seq
    try {
      const res = await window.spadewick.stats.balance({ setId, by: by || undefined, split: split || undefined, copies, filter: filter || undefined, unique })
      if (mine !== seq) return
      data = res; error = ''
      if (!by && res.by) by = res.by   // the field the view chose by itself
    } catch (err) { if (mine === seq) error = err.message }
  }
  // the data changed somewhere (an edit, an import, an undo): look again
  const onChanged = () => refreshSoon()
  onMount(() => { window.addEventListener(PROJECT_CHANGED, onChanged) })
  onDestroy(() => { clearTimeout(timer); window.removeEventListener(PROJECT_CHANGED, onChanged) })

  $: max = Math.max(1, ...(data?.chart?.buckets ?? []).map(b => b.count))
  $: splitKeys = data?.chart?.splitKeys ?? []
  $: shownWarnings = data ? (showAllWarnings ? data.warnings : data.warnings.slice(0, 30)) : []
  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0)
  const goto = w => { focusCard(setId, w.cardId); activeTab.set('cards') }
  const toggleUnique = slug => { unique = unique.includes(slug) ? unique.filter(s => s !== slug) : [...unique, slug] }
  const isDefaultUnique = slug => data?.checkedForDuplicates?.includes(slug) && !unique.includes(slug)
</script>

<div class="balance">
  {#if !setId}
    <div class="hint">{tr('mainPanel.selectOrCreateASet')}</div>
  {:else}
    <div class="controls" role="group" aria-label="{tr('balance.controls')}">
      <label>{tr('balance.countBy')}
        <select bind:value={by}>
          {#each data?.fields ?? [] as f (f.slug)}<option value={f.slug}>{f.name}</option>{/each}
        </select>
      </label>
      <label>{tr('balance.splitBy')}
        <select bind:value={split}>
          <option value="">{tr('common.none')}</option>
          {#each (data?.fields ?? []).filter(f => f.slug !== by) as f (f.slug)}<option value={f.slug}>{f.name}</option>{/each}
        </select>
      </label>
      <fieldset class="count-mode">
        <legend>{tr('balance.count')}</legend>
        <label><input type="radio" bind:group={copies} value={false} /> {tr('balance.cards')}</label>
        <label><input type="radio" bind:group={copies} value={true} /> {tr('balance.copies')}</label>
      </fieldset>
      <label>{tr('balance.onlyView')}
        <select bind:value={viewId}>
          <option value="">{tr('cardDataEditor.allCards')}</option>
          {#each views as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
        </select>
      </label>
      <details class="dupes">
        <summary>{tr('balance.duplicatesIn')}</summary>
        <div class="dupe-list">
          {#each data?.fields ?? [] as f (f.slug)}
            <label><input type="checkbox" checked={unique.includes(f.slug) || isDefaultUnique(f.slug)} disabled={isDefaultUnique(f.slug)} on:change={() => toggleUnique(f.slug)} /> {f.name}</label>
          {/each}
        </div>
      </details>
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    {#if data}
      <p class="totals" role="status">{tr('balance.totals', { cards: data.cardCount, copies: data.copyCount, set: data.setName })}</p>

      <section aria-labelledby="chart-h">
        <h2 id="chart-h">{data.chart ? tr('balance.chartTitle', { name: data.chart.name, unit: tr(copies ? 'balance.copies' : 'balance.cards').toLowerCase() }) : tr('balance.noChart')}</h2>
        {#if data.chart}
          {#if data.chart.splitName}
            <ul class="legend" aria-label="{data.chart.splitName}">
              {#each splitKeys as k, i (k)}<li><span class="swatch" style="background:{colorOf(i)}" /> {labelOf(k)}</li>{/each}
            </ul>
          {/if}
          <ol class="bars" aria-label="{data.chart.name}">
            {#each data.chart.buckets as b (b.key)}
              <li>
                <span class="label" title={labelOf(b.label)}>{labelOf(b.label)}</span>
                <span class="track">
                  {#if data.chart.splitName}
                    {#each splitKeys as k, i (k)}
                      {#if b.parts[k]}<span class="seg" style="width:{(b.parts[k] / max) * 100}%;background:{colorOf(i)}" title="{labelOf(k)}: {b.parts[k]}" />{/if}
                    {/each}
                  {:else}
                    <span class="seg single" style="width:{(b.count / max) * 100}%" />
                  {/if}
                </span>
                <span class="num">{b.count} <span class="dim">{pct(b.count, data.chart.total)}%</span></span>
              </li>
            {:else}
              <li class="dim">{tr('balance.noCards')}</li>
            {/each}
          </ol>
          {#if data.chart.stats}
            {@const s = data.chart.stats}
            <p class="stats">{tr('balance.numberStats', { min: s.min, max: s.max, mean: s.mean, median: s.median, sum: s.sum })}</p>
          {/if}
        {/if}
      </section>

      <section aria-labelledby="warn-h">
        <h2 id="warn-h">{tr('balance.warningsTitle', { n: data.warningCount })}</h2>
        {#if !data.warningCount}
          <p class="ok">{tr('balance.noWarnings')}</p>
        {:else}
          <table class="warnings" aria-labelledby="warn-h">
            <thead><tr><th scope="col">{tr('balance.card')}</th><th scope="col">{tr('common.field')}</th><th scope="col">{tr('dataIoDialog.problem')}</th><th scope="col"><span class="sr-only">{tr('balance.go')}</span></th></tr></thead>
            <tbody>
              {#each shownWarnings as w, i (i)}
                <tr>
                  <td>{w.cardName || tr('cardDataEditor.unnamedCard')}</td>
                  <td>{w.field}</td>
                  <td>{w.message}</td>
                  <td><button on:click={() => goto(w)}>{tr('balance.showCard')}</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if data.warnings.length > shownWarnings.length}
            <button on:click={() => (showAllWarnings = true)}>{tr('balance.showAll', { n: data.warnings.length })}</button>
          {/if}
          {#if data.warningCount > data.warnings.length}<p class="dim">{tr('balance.warningsCapped', { n: data.warnings.length, total: data.warningCount })}</p>{/if}
        {/if}
      </section>

      <section aria-labelledby="sum-h">
        <h2 id="sum-h">{tr('balance.summaryTitle')}</h2>
        <table class="summary" aria-labelledby="sum-h">
          <thead><tr>
            <th scope="col">{tr('common.field')}</th><th scope="col">{tr('fieldManager.type')}</th><th scope="col" class="n">{tr('balance.filled')}</th><th scope="col" class="n">{tr('balance.empty2')}</th>
            <th scope="col" class="n">{tr('balance.different')}</th><th scope="col" class="n">{tr('fieldManager.min')}</th><th scope="col" class="n">{tr('fieldManager.max')}</th><th scope="col" class="n">{tr('balance.mean')}</th>
          </tr></thead>
          <tbody>
            {#each data.summary as r (r.slug)}
              <tr>
                <th scope="row">{r.name}</th><td>{tr(`fieldManager.types.${r.type}`)}</td><td class="n">{r.filled}</td><td class="n" class:warn={r.empty > 0}>{r.empty}</td>
                <td class="n">{r.distinct}</td><td class="n">{r.min ?? ''}</td><td class="n">{r.max ?? ''}</td><td class="n">{r.mean ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}
  {/if}
</div>

<style>
  .balance { flex: 1; overflow: auto; padding: 12px 16px 24px; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .hint { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--color-text-dim); font-style: italic; }
  .controls { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: flex-end; }
  .controls label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--color-text-dim); }
  .count-mode { border: none; padding: 0; margin: 0; display: flex; gap: 10px; align-items: center; font-size: 12px; }
  .count-mode legend { font-size: 11px; color: var(--color-text-dim); padding: 0; }
  .count-mode label { flex-direction: row; align-items: center; gap: 4px; color: var(--color-text); font-size: 12px; }
  .dupes summary { cursor: pointer; font-size: 12px; }
  .dupe-list { display: flex; flex-direction: column; gap: 3px; padding: 6px 0; max-height: 200px; overflow: auto; }
  .dupe-list label { flex-direction: row; align-items: center; gap: 6px; color: var(--color-text); font-size: 12px; }
  h2 { font-size: 13px; margin: 12px 0 6px; }
  .totals { margin: 0; font-size: 12px; color: var(--color-text-dim); }
  .error { color: var(--color-danger-text); }
  .dim { color: var(--color-text-dim); }
  .ok { color: var(--color-text-dim); margin: 0; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; list-style: none; padding: 0; margin: 0 0 6px; font-size: 12px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
  .bars { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  .bars li { display: grid; grid-template-columns: 130px 1fr 90px; gap: 8px; align-items: center; font-size: 12px; }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
  .track { display: flex; height: 18px; background: var(--color-surface-2); border-radius: 3px; overflow: hidden; }
  .seg { height: 100%; }
  .seg.single { background: var(--color-accent); }
  .num { font-variant-numeric: tabular-nums; }
  .stats { font-size: 12px; color: var(--color-text-dim); margin: 6px 0 0; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--color-border); }
  th.n, td.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.warn { color: var(--color-danger-text); }
  tbody th { font-weight: 600; }
</style>
