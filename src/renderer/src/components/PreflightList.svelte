<script>
  /**
   * The findings of the print preflight (PRD §17.7), grouped: what is wrong, where (template and element), which cards, what to
   * do, and Show me, which opens the template editor on the element. Used by the preflight dialog and by the production panel.
   */
  import { createEventDispatcher } from 'svelte'
  import { tr } from '../../../shared/i18n.js'

  export let result = null
  export let onlyErrors = false
  const dispatch = createEventDispatcher()

  const kind = k => (k === 'opacity' ? tr('preflight.kindOpacity') : k === 'blend' ? tr('preflight.kindBlend') : k === 'filter' ? tr('preflight.kindFilter') : tr('preflight.kindMask'))

  function message(g) {
    const d = g.detail
    switch (g.type) {
      case 'noBleed': return tr('preflight.msgNoBleed')
      case 'backMissing': return tr('preflight.msgBackMissing')
      case 'backSome': return tr('preflight.msgBackSome', { n: d.n })
      case 'backPlain': return tr('preflight.msgBackPlain')
      case 'backFile': return tr('preflight.msgBackFile')
      case 'backShape': return tr('preflight.msgBackShape', { ratio: d.ratio, want: d.want })
      case 'missingImage': return tr('preflight.msgMissingImage', { name: d.name || '…' })
      case 'imageLowRes': return tr('preflight.msgImageLowRes', { ppi: d.ppi, min: d.min })
      case 'missingIcon': return tr('preflight.msgMissingIcon', { name: d.name })
      case 'missingGlyph': return tr('preflight.msgMissingGlyph', { char: d.char, code: d.code.toString(16).toUpperCase().padStart(4, '0') })
      case 'noFit': return tr('preflight.msgNoFit', { min: d.min })
      case 'cardError': return tr('preflight.msgCardError', { message: d.message })
      case 'fontForbids': return d.level === 'restricted' ? tr('preflight.msgFontForbids', { family: d.family, style: d.style }) : tr('preflight.msgFontPreview', { family: d.family, style: d.style })
      case 'safeArea': return tr('preflight.msgSafeArea')
      case 'textSmall': return d.reversed ? tr('preflight.msgTextSmallReversed', { pt: d.pt, min: d.min }) : tr('preflight.msgTextSmall', { pt: d.pt, min: d.min })
      case 'blackText': return d.printColor ? tr('preflight.msgBlackTextFixed') : tr('preflight.msgBlackText')
      case 'strokeThin': return tr('preflight.msgStrokeThin', { widthPt: d.widthPt, min: d.min })
      case 'inkLimit': return tr('preflight.msgInkLimit', { max: g.max, limit: d.limit })
      case 'edgeNotPlain': return d.reason === 'transparent' ? tr('preflight.msgEdgeTransparent') : tr('preflight.msgEdgeBusy')
      case 'dieLineMissing': return tr('preflight.msgDieLineMissing')
      case 'settings': return d.problem === 'marksMargin' ? tr('preflight.msgSettingsMarks') : d.problem === 'safeLarge' ? tr('preflight.msgSettingsSafe') : tr('preflight.msgSettingsDie')
      case 'profileMissing': return tr('preflight.msgProfileMissing')
      case 'outOfGamut': return tr('preflight.msgOutOfGamut', { pct: g.max })
      case 'transparency': return tr('preflight.msgTransparency', { kind: kind(d.kind) })
      case 'bleedCarried': return tr('preflight.msgBleedCarried', { have: d.have, want: d.want })
      case 'deckSize': return tr('preflight.msgDeckSize', { count: d.count, rule: d.problem === 'min' ? tr('preflight.ruleMin', { name: d.name, min: d.min, add: d.add }) : d.problem === 'max' ? tr('preflight.ruleMax', { name: d.name, max: d.max, remove: d.remove }) : tr('preflight.ruleMultiple', { name: d.name, multiple: d.multiple, add: d.add, remove: d.remove }) })
      case 'presetSize': return tr('preflight.msgPresetSize', { name: d.name, sizes: (d.sizes ?? []).join(', '), size: d.size })
      case 'presetProfile': return tr('preflight.msgPresetProfile', { name: d.name, hint: d.hint })
      case 'presetUnverified': return tr('preflight.msgPresetUnverified', { name: d.name, fields: d.fields.join(', ') })
      case 'presetVector': return tr('preflight.msgPresetVector', { name: d.name, rules: d.rules.join(', ') })
      default: return tr('preflight.msgFileSize', { mb: d.mb })
    }
  }
  function fix(g) {
    switch (g.type) {
      case 'noBleed': return tr('preflight.fixNoBleed')
      case 'backMissing': return tr('preflight.fixBackMissing')
      case 'backSome': return tr('preflight.fixBackSome')
      case 'backPlain': return tr('preflight.fixBackPlain')
      case 'backFile': return tr('preflight.fixBackFile')
      case 'backShape': return tr('preflight.fixBackShape')
      case 'missingImage': return tr('preflight.fixMissingImage')
      case 'imageLowRes': return tr('preflight.fixImageLowRes')
      case 'missingIcon': return tr('preflight.fixMissingIcon')
      case 'missingGlyph': return tr('preflight.fixMissingGlyph')
      case 'noFit': return tr('preflight.fixNoFit')
      case 'cardError': return tr('preflight.fixCardError')
      case 'fontForbids': return tr('preflight.fixFont')
      case 'safeArea': return tr('preflight.fixSafeArea')
      case 'textSmall': return tr('preflight.fixTextSmall')
      case 'blackText': return tr('preflight.fixBlackText')
      case 'strokeThin': return tr('preflight.fixStrokeThin')
      case 'inkLimit': return tr('preflight.fixInkLimit')
      case 'edgeNotPlain': return tr('preflight.fixEdge')
      case 'dieLineMissing': return tr('preflight.fixDieLineMissing')
      case 'settings': return tr('preflight.fixSettings')
      case 'profileMissing': return tr('preflight.fixProfileMissing')
      case 'outOfGamut': return tr('preflight.fixOutOfGamut')
      case 'transparency': return tr('preflight.fixTransparency')
      case 'bleedCarried': return tr('preflight.fixBleedCarried')
      case 'deckSize': return tr('preflight.fixDeckSize')
      case 'presetSize': return tr('preflight.fixPresetSize')
      case 'presetProfile': return tr('preflight.fixPresetProfile')
      case 'presetUnverified': return tr('preflight.fixPresetUnverified')
      case 'presetVector': return tr('preflight.fixPresetVector')
      default: return tr('preflight.fixFileSize')
    }
  }
  const severityLabel = s => (s === 'error' ? tr('preflight.error') : s === 'warning' ? tr('preflight.warning') : tr('preflight.info'))
  const where = g => [g.template?.name, g.element?.field ?? g.element?.id].filter(Boolean).join(' › ')
  const cardsText = g => {
    const names = g.cards.slice(0, 5).map(c => c.name || c.set)
    return names.join(', ') + (g.count > names.length ? ` ${tr('preflight.cardsMore', { n: g.count - names.length })}` : '')
  }
  const canShow = g => !!g.template && g.cards.length > 0
  function show(g) { dispatch('show', { templateId: g.template.id, elementId: g.element?.id ?? null, cardId: g.cards[0].id }) }

  $: groups = result ? result.groups.filter(g => !onlyErrors || g.severity === 'error') : []
</script>

{#if result && !groups.length}
  <p class="ok" role="status">{tr('preflight.allClear')}</p>
{:else if result}
  <table aria-label={tr('preflight.title')}>
    <thead><tr><th scope="col">{tr('preflight.severity')}</th><th scope="col">{tr('preflight.problem')}</th><th scope="col">{tr('preflight.where')}</th><th scope="col">{tr('preflight.cards')}</th><th scope="col"><span class="sr-only">{tr('preflight.showMe')}</span></th></tr></thead>
    <tbody>
      {#each groups as g}
        <tr class={g.severity}>
          <td><span class="badge {g.severity}">{severityLabel(g.severity)}</span></td>
          <td>{message(g)}<div class="fix">{tr('preflight.whatToDo')}: {fix(g)}</div></td>
          <td class="dim">{where(g)}</td>
          <td class="dim">{#if g.cards.length}{cardsText(g)}{/if}</td>
          <td>{#if canShow(g)}<button type="button" on:click={() => show(g)} aria-label={tr('preflight.showMeFor', { what: message(g) })}>{tr('preflight.showMe')}</button>{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
  .dim { color: var(--color-text-dim); }
  .fix { color: var(--color-text-dim); font-size: 11px; margin-top: 2px; }
  .ok { color: var(--color-success-text); font-size: 12px; }
  .badge { display: inline-block; padding: 0 6px; border-radius: var(--radius); font-size: 11px; border: 1px solid currentColor; }
  .badge.error { color: var(--color-danger-text); }
  .badge.warning { color: var(--color-warning-text); }
  .badge.info { color: var(--color-text-dim); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
