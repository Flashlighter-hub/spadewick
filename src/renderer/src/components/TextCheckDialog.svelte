<script>
  /**
   * The text check (PRD §16.9): every card drawn through the text step, and what went wrong listed with the cards it
   * affects: missing icons and characters, text that does not fit, markup that does not pair up, unknown styles,
   * ambiguous icon aliases, and fonts that forbid embedding.
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import Modal from './Modal.svelte'
  import { toast } from '../stores/ui.js'

  const dispatch = createEventDispatcher()
  let result = null, running = false, onlyErrors = false

  async function run() {
    running = true
    try { result = await window.spadewick.textCheck.run() } catch (err) { toast(err.message, 'error', 6000) } finally { running = false }
  }
  onMount(run)

  const severityLabel = s => (s === 'error' ? tr('textCheck.error') : s === 'warning' ? tr('textCheck.warning') : tr('textCheck.info'))

  function message(g) {
    const d = g.detail
    switch (g.type) {
      case 'missingIcon': return tr('textCheck.missingIcon', { name: d.name })
      case 'missingGlyph': return tr('textCheck.missingGlyph', { char: d.char, code: d.code.toString(16).toUpperCase().padStart(4, '0') })
      case 'noFit': return tr('textCheck.noFit', { min: d.min })
      case 'fontForbids': return d.level === 'restricted' ? tr('textCheck.fontForbids', { family: d.family, style: d.style }) : tr('textCheck.fontPreviewOnly', { family: d.family, style: d.style })
      case 'markup':
        return d.problem === 'unmatched' ? tr('richText.problemUnmatched', { text: d.text })
          : d.problem === 'unknownStyle' ? tr('richText.problemStyle', { name: d.text })
          : d.problem === 'badIconParam' ? tr('richText.problemIconParam', { text: d.text })
          : tr('richText.problemInvalid', { text: d.text })
      case 'ambiguousAlias': return tr('textCheck.ambiguousAlias', { alias: d.alias, icons: d.icons.join(', ') })
      case 'native': return tr('textCheck.native', { reason: d.reason })
      default: return tr('textCheck.cardError', { message: d.message })
    }
  }
  const where = g => [g.template?.name, g.element?.id ?? g.element?.field].filter(Boolean).join(' › ')
  const cardsText = g => {
    const names = g.cards.slice(0, 5).map(c => c.name || c.set)
    return names.join(', ') + (g.count > names.length ? ` ${tr('textCheck.cardsMore', { n: g.count - names.length })}` : '')
  }
  $: groups = result ? result.groups.filter(g => !onlyErrors || g.severity === 'error') : []
</script>

<Modal title={tr('textCheck.title')} width={900} on:close={() => dispatch('close')}>
  <div class="bar">
    <button on:click={run} disabled={running}>{running ? tr('textCheck.running') : tr('textCheck.runAgain')}</button>
    <label class="check"><input type="checkbox" bind:checked={onlyErrors} /> {tr('textCheck.onlyErrors')}</label>
    {#if result}<span class="summary" role="status">{tr('textCheck.summary', { n: result.checked, errors: result.counts.error, warnings: result.counts.warning, info: result.counts.info })}</span>{/if}
  </div>

  {#if running && !result}
    <p class="dim" role="status">{tr('textCheck.running')}</p>
  {:else if result && !groups.length}
    <p class="ok" role="status">{tr('textCheck.noProblems')}</p>
  {:else if result}
    <table aria-label={tr('textCheck.title')}>
      <thead><tr><th scope="col">{tr('textCheck.severity')}</th><th scope="col">{tr('textCheck.problem')}</th><th scope="col">{tr('textCheck.where')}</th><th scope="col">{tr('textCheck.cards')}</th></tr></thead>
      <tbody>
        {#each groups as g}
          <tr class={g.severity}>
            <td><span class="badge {g.severity}">{severityLabel(g.severity)}</span></td>
            <td>{message(g)}</td>
            <td class="dim">{where(g)}</td>
            <td class="dim">{#if g.cards.length}{cardsText(g)}{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <svelte:fragment slot="footer"><span style="flex:1" /><button on:click={() => dispatch('close')}>{tr('common.done')}</button></svelte:fragment>
</Modal>

<style>
  .bar { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
  .summary { margin-left: auto; font-size: 12px; color: var(--color-text-dim); }
  .check { display: flex; gap: 4px; align-items: center; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
  .dim { color: var(--color-text-dim); }
  .ok { color: var(--color-success-text); }
  .badge { display: inline-block; padding: 0 6px; border-radius: var(--radius); font-size: 11px; border: 1px solid currentColor; }
  .badge.error { color: var(--color-danger-text); }
  .badge.warning { color: var(--color-warning-text); }
  .badge.info { color: var(--color-text-dim); }
</style>
