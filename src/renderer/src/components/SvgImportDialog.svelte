<script context="module">
  // The folders the person has pointed at for linked pictures: kept while the application is open, so the next designs of the same set
  // find their textures without being asked again.
  let rememberedDirs = []
</script>

<script>
  /**
   * Import SVG (PRD §19.2) and Re-import design (§19.4): a guided dialog in three steps (size, clean-up report, binding
   * review) for a design drawn in another tool. One file at a time; several files are done in turn.
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import { tr } from '../../../shared/i18n.js'
  import Modal from './Modal.svelte'
  import CardSizePicker from './CardSizePicker.svelte'
  import { toast } from '../stores/ui.js'

  export let paths = []            // the design files, in order
  export let setId                 // the set whose fields the design is bound to
  export let setName = ''
  export let setSize = null        // { id, mmW, mmH } of that set
  export let templateId = null     // re-import into this template (its size is locked)
  const dispatch = createEventDispatcher()

  let index = 0
  let step = 0                     // 0 size, 1 clean-up, 2 binding
  let a = null                     // the analysis of the current file
  let busy = true, error = ''
  let name = '', size = { cardSize: 'poker', cardMmW: 63.5, cardMmH: 88.9 }, fit = 'fit', bleed = 0
  let fontMap = {}, linked = {}
  let searchDirs = [...rememberedDirs]
  let state = {}                   // row key -> { checked, choice, newName }
  let keep = {}                    // removed binding id -> keep?
  let imported = []
  let selectedKey = null
  let guideOpen = false

  $: path = paths[index]
  $: reimport = !!templateId

  const UNIT = { px: tr('svgImport.unitPx'), pt: tr('svgImport.unitPt'), mm: tr('svgImport.unitMm'), cm: tr('svgImport.unitCm'), in: tr('svgImport.unitIn'), pc: tr('svgImport.unitPc'), q: tr('svgImport.unitQ') }
  const GENERATOR = { illustrator: tr('svgImport.genIllustrator'), inkscape: tr('svgImport.genInkscape'), sketch: tr('svgImport.genSketch'), affinity: tr('svgImport.genAffinity'), figma: tr('svgImport.genFigma'), unknown: tr('svgImport.genUnknown') }
  const sizeName = s => (s.cardSize && s.cardSize !== 'custom' && s.cardSize !== 'fixed' ? tr(`cardSizes.${s.cardSize}`) : `${s.cardMmW} × ${s.cardMmH} ${tr('common.mm')}`)

  async function load(keepChoices = false) {
    busy = true; error = ''
    try {
      const res = await window.spadewick.svgImport.analyze({ path, setId, templateId, bleedMm: Number(bleed) || 0, linked, searchDirs })
      const before = state
      a = res
      if (!keepChoices) {
        name = res.file.name.replace(/\.svg$/i, '')
        size = { cardSize: res.proposal.cardSize, cardMmW: res.proposal.cardMmW, cardMmH: res.proposal.cardMmH }
        if (reimport) { fit = res.reimport.previous.fit; bleed = res.reimport.previous.bleedMm; fontMap = { ...res.reimport.previous.fontMap }; keep = {} }
        else { fit = 'fit'; fontMap = {} }
      }
      state = {}
      for (const r of res.rows) {
        const old = before[r.key]
        state[r.key] = old && keepChoices ? old : { checked: r.checked, choice: choiceOf(r.proposal), newName: r.proposal.newName ?? r.proposal.suggestNew?.name ?? r.name ?? '', freeText: r.proposal.text ?? r.sample ?? '' }
      }
      selectedKey = null
    } catch (err) {
      error = err.message
    } finally { busy = false }
  }

  function choiceOf(p) {
    if (p.action === 'field' || p.action === 'token' || p.action === 'image' || p.action === 'color') return `field:${p.slug}`
    if (p.action === 'free') return 'free'
    if (p.action === 'new') return 'new'
    if (p.suggestNew) return 'new'
    return p.action
  }

  onMount(() => load())

  /** The decisions to send: what is checked, as the choice says. */
  function decisions() {
    const out = []
    for (const r of a.rows) {
      const s = state[r.key]
      if (!s?.checked) continue
      const p = r.proposal
      if (['show', 'hide', 'icon', 'box'].includes(p.action) && s.choice === p.action) { out.push({ key: r.key, action: p.action, expr: p.expr, icon: p.icon }); continue }
      if (p.action === 'token' && s.choice === `field:${p.slug}`) { out.push({ key: r.key, action: 'token', slug: p.slug }); continue }
      if (s.choice === 'free') { out.push({ key: r.key, action: 'free', text: s.freeText }); continue }
      if (s.choice === 'new') {
        out.push({ key: r.key, action: 'new', newName: String(s.newName || r.name || '').trim(), slug: p.fromToken ? p.slug : undefined, newType: newTypeOf(r), fromToken: p.fromToken })
        continue
      }
      if (s.choice?.startsWith('field:')) {
        const slug = s.choice.slice(6)
        const f = a.fields.find(x => x.slug === slug)
        out.push({ key: r.key, action: r.kind === 'text' ? 'field' : f?.type === 'color' ? 'color' : 'image', slug })
      }
    }
    return out
  }
  const newTypeOf = r => (r.proposal.suggestNew?.type ?? r.proposal.newType ?? (r.kind === 'image' ? 'image_ref' : r.kind === 'shape' ? 'color' : 'text'))

  const optionsOf = r => a.fields.filter(f => r.options.includes(f.slug))
  const isFixed = r => ['show', 'hide', 'icon', 'box'].includes(r.proposal.action)
  const typeLabel = r => (r.kind === 'text' ? tr('svgImport.kindText') : r.kind === 'image' ? tr('svgImport.kindImage') : r.kind === 'shape' ? tr('svgImport.kindShape') : tr('svgImport.kindGroup'))
  const confidenceLabel = r => {
    if (r.confidence === 'exact') return tr('svgImport.confExact')
    if (r.confidence === 'token') return r.note === 'tokenNew' ? tr('svgImport.confTokenNew') : tr('svgImport.confToken')
    if (r.confidence === 'kept') return tr('svgImport.confKept')
    if (r.confidence === 'close') {
      const f = a.fields.find(x => x.slug === r.proposal.slug)
      const field = f?.name ?? r.proposal.slug
      return r.note === 'copy' ? tr('svgImport.confCopy', { name: r.name, field }) : r.note === 'spelling' ? tr('svgImport.confSpelling', { name: r.name, field }) : tr('svgImport.confClose', { name: r.name, field })
    }
    return tr('svgImport.confNone')
  }
  const fixedLabel = r => {
    const p = r.proposal
    return p.action === 'show' ? tr('svgImport.fixedShow', { expr: p.expr }) : p.action === 'hide' ? tr('svgImport.fixedHide', { expr: p.expr }) : p.action === 'icon' ? tr('svgImport.fixedIcon', { name: p.icon }) : tr('svgImport.fixedBox', { name: r.boxFor ?? '' })
  }
  const rowName = r => r.name || (r.kind === 'text' ? `“${(r.sample ?? '').slice(0, 24)}”` : typeLabel(r))

  // Where the selected element is, over the preview (view box coordinates -> percent)
  $: sel = a && selectedKey ? a.rows.find(r => r.key === selectedKey) : null
  $: box = sel?.rect && a ? { l: (sel.rect[0] - a.previewBox[0]) / a.previewBox[2] * 100, t: (sel.rect[1] - a.previewBox[1]) / a.previewBox[3] * 100, w: sel.rect[2] / a.previewBox[2] * 100, h: sel.rect[3] / a.previewBox[3] * 100 } : null

  const checkedCount = () => Object.values(state).filter(s => s.checked).length
  function setAll(mode) {
    for (const r of a.rows) {
      const s = state[r.key]
      if (mode === 'exact') s.checked = r.confidence === 'exact' || r.confidence === 'token' || r.confidence === 'kept'
      else if (mode === 'all') s.checked = r.proposal.action !== 'none' || s.choice === 'new'
      else s.checked = false
    }
    state = state
  }

  async function locate(key) {
    const r = await window.spadewick.svgImport.pickImage()
    if (!r.path) return
    linked = { ...linked, [key]: r.path }
    // the other pictures that are in the same folder are found too, and so are those of the designs that follow
    const dir = r.path.replace(/[\\/][^\\/]*$/, '')
    if (dir && !searchDirs.includes(dir)) { searchDirs = [...searchDirs, dir]; rememberedDirs = searchDirs }
    await load(true)
  }

  let bleedTimer
  const bleedChanged = () => { clearTimeout(bleedTimer); bleedTimer = setTimeout(() => load(true), 300) }

  // ---- finishing --------------------------------------------------------------------------------------------

  async function finish() {
    busy = true; error = ''
    try {
      const keepRemoved = a.reimport ? a.reimport.removed.filter(x => keep[x.id]).map(x => x.id) : []
      const res = await window.spadewick.svgImport.apply({
        path, setId, templateId, name, size: reimport ? undefined : size, fit, bleedMm: Number(bleed) || 0, fontMap: Object.fromEntries(Object.entries(fontMap).filter(([, v]) => v)),
        linked, searchDirs, decisions: decisions(), keepRemoved
      })
      imported = [...imported, res]
      for (const w of res.warnings) toast(w === 'boxRotated' ? tr('svgImport.warnBoxRotated') : w === 'boxTransform' ? tr('svgImport.warnBoxTransform') : w === 'offCanvas' ? tr('svgImport.warnOffCanvas') : w === 'layersLimit' ? tr('svgImport.warnLayersLimit') : tr('svgImport.warnImageNoBox'), 'info', 6000)
      if (index + 1 < paths.length) { index++; step = 0; linked = {}; await load() }
      else dispatch('done', { results: imported })
    } catch (err) {
      error = err.message
      busy = false
    }
  }
  const skip = async () => {
    if (index + 1 < paths.length) { index++; step = 0; linked = {}; await load() }
    else if (imported.length) dispatch('done', { results: imported })
    else dispatch('close')
  }

  $: stepNames = [tr('svgImport.stepSize'), tr('svgImport.stepCleanup'), tr('svgImport.stepBinding')]
  $: cardRatio = a ? (reimport ? a.proposal.cardMmW / a.proposal.cardMmH : size.cardMmW / size.cardMmH) : 1
  $: differs = !!a && Math.abs(a.size.viewBox[2] / a.size.viewBox[3] - cardRatio) / cardRatio > 0.005
  $: customBad = !reimport && size.cardSize === 'custom' && !(Number(size.cardMmW) >= 10 && Number(size.cardMmH) >= 10)
  $: canNext = !busy && !!a && !customBad && !(step === 0 && !reimport && !name.trim())
  const removed = () => a?.report.removed ?? {}
  $: removedLines = a ? [
    [removed().scripts, 'svgImport.removedScripts'], [removed().handlers, 'svgImport.removedHandlers'], [removed().foreignObjects, 'svgImport.removedForeign'],
    [removed().animations, 'svgImport.removedAnimations'], [removed().metadata, 'svgImport.removedMetadata'], [removed().hidden, 'svgImport.removedHidden'],
    [removed().externalRefs, 'svgImport.removedExternal'], [removed().styleImports + removed().fontFaces, 'svgImport.removedStyleFonts'], [removed().unsupportedImages, 'svgImport.removedImages']
  ].filter(([n]) => n > 0) : []
  const removedText = (n, key) => {
    switch (key) {
      case 'svgImport.removedScripts': return tr('svgImport.removedScripts', { n })
      case 'svgImport.removedHandlers': return tr('svgImport.removedHandlers', { n })
      case 'svgImport.removedForeign': return tr('svgImport.removedForeign', { n })
      case 'svgImport.removedAnimations': return tr('svgImport.removedAnimations', { n })
      case 'svgImport.removedMetadata': return tr('svgImport.removedMetadata', { n })
      case 'svgImport.removedHidden': return tr('svgImport.removedHidden', { n })
      case 'svgImport.removedExternal': return tr('svgImport.removedExternal', { n })
      case 'svgImport.removedStyleFonts': return tr('svgImport.removedStyleFonts', { n })
      default: return tr('svgImport.removedImages', { n })
    }
  }
  const unsupportedText = (kind, n) => (kind === 'filter' || kind === 'filterUse' ? tr('svgImport.unsupFilter', { n }) : kind === 'mask' ? tr('svgImport.unsupMask', { n }) : kind === 'pattern' ? tr('svgImport.unsupPattern', { n }) : tr('svgImport.unsupBlend', { n }))
  $: unsupportedLines = a ? Object.entries(a.report.unsupported) : []
  $: missingFonts = a ? a.report.fonts.filter(f => f.status === 'missing') : []
  $: linkedImages = a ? a.report.images.linked : []
  const mapOptions = () => (a ? a.availableFonts : [])
</script>

<Modal title={reimport ? tr('svgImport.titleReimport') : tr('svgImport.title')} width={1060} on:close={() => dispatch('close')}>
  <div class="head">
    {#if paths.length > 1}<span class="file" role="status">{tr('svgImport.fileOf', { n: index + 1, total: paths.length, name: a?.file.name ?? '' })}</span>{:else if a}<span class="file">{a.file.name}</span>{/if}
    <ol class="steps" aria-label={tr('svgImport.stepsLabel')}>
      {#each stepNames as s, i}<li class:current={i === step} aria-current={i === step ? 'step' : undefined}>{i + 1}. {s}</li>{/each}
    </ol>
  </div>

  {#if error}<div class="error" role="alert">{error}</div>{/if}

  {#if busy && !a}
    <p class="dim" role="status">{tr('svgImport.reading')}</p>
  {:else if a}
    <div class="body">
      <div class="side">
        <div class="preview" aria-label={tr('svgImport.previewLabel')} role="img">
          <img src="data:image/png;base64,{a.preview}" alt="" />
          {#if box && step === 2}<span class="hl" style="left:{box.l}%;top:{box.t}%;width:{box.w}%;height:{box.h}%"></span>{/if}
        </div>
        <p class="dim small">{tr('svgImport.previewNote')}</p>
      </div>

      <div class="main">
        {#if step === 0}
          <section aria-label={tr('svgImport.stepSize')}>
            <p>{tr('svgImport.sizeRead', { w: Math.round(a.size.viewBox[2] * 100) / 100, h: Math.round(a.size.viewBox[3] * 100) / 100, mmW: a.size.widthMm, mmH: a.size.heightMm, tool: GENERATOR[a.size.generator] ?? GENERATOR.unknown })}</p>
            {#if a.size.assumed}<p class="note">{tr('svgImport.sizeAssumed', { unit: UNIT[a.size.unit] ?? a.size.unit })}</p>{/if}

            {#if reimport}
              <p class="note">{tr('svgImport.sizeLocked', { size: sizeName(a.proposal) })}</p>
            {:else}
              <label class="stack">{tr('svgImport.templateName')}<input class="field" bind:value={name} /></label>
              <CardSizePicker label={tr('svgImport.cardSize')} value={size.cardSize} mmW={size.cardMmW} mmH={size.cardMmH} on:change={e => (size = e.detail)} />
              {#if setSize && (setSize.mmW !== size.cardMmW || setSize.mmH !== size.cardMmH)}
                <p class="note">{tr('svgImport.sizeOtherThanSet', { set: setName, size: sizeName({ cardSize: setSize.id, cardMmW: setSize.mmW, cardMmH: setSize.mmH }) })}
                  <button type="button" on:click={() => (size = { cardSize: setSize.id, cardMmW: setSize.mmW, cardMmH: setSize.mmH })}>{tr('svgImport.useSetSize')}</button></p>
              {/if}
            {/if}

            {#if differs}
              <fieldset class="fit">
                <legend>{tr('svgImport.fitLegend')}</legend>
                <p class="dim small">{tr('svgImport.fitExplain')}</p>
                <label><input type="radio" bind:group={fit} value="fit" /> {tr('svgImport.fitFit')}</label>
                <label><input type="radio" bind:group={fit} value="keep" /> {tr('svgImport.fitKeep')}</label>
                <label><input type="radio" bind:group={fit} value="crop" /> {tr('svgImport.fitCrop')}</label>
              </fieldset>
            {/if}

            <label class="stack bleed">{tr('svgImport.bleed')}
              <span><input type="number" min="0" max="20" step="0.1" bind:value={bleed} on:change={bleedChanged} aria-describedby="bleed-help" /> {tr('common.mm')}</span>
            </label>
            <p class="dim small" id="bleed-help">{tr('svgImport.bleedHelp')}</p>
            <p class="dim small">{tr('svgImport.boundToSet', { set: setName })}</p>
          </section>
        {:else if step === 1}
          <section aria-label={tr('svgImport.stepCleanup')}>
            <h3>{tr('svgImport.removedHeading')}</h3>
            {#if removedLines.length}
              <ul>{#each removedLines as [n, key]}<li>{removedText(n, key)}</li>{/each}</ul>
            {:else}<p class="dim">{tr('svgImport.nothingRemoved')}</p>{/if}
            {#if a.report.styleSheetKept}<p class="note">{tr('svgImport.styleKept')}</p>{/if}

            <h3>{tr('svgImport.imagesHeading')}</h3>
            <p>{tr('svgImport.imagesEmbedded', { n: a.report.images.embedded })}</p>
            {#if linkedImages.some(l => !l.found)}<p class="note">{tr('svgImport.linkedHelp')}</p>{/if}
            {#if linkedImages.length}
              <ul class="linked">
                {#each linkedImages as l}
                  <li>
                    <span class="mono">{l.href}</span> —
                    {#if l.found}<span class="ok">{tr('svgImport.linkedFound')}</span>{:else}<span class="warn">{tr('svgImport.linkedMissing')}</span>
                      <button type="button" on:click={() => locate(l.key)}>{tr('svgImport.locate')}</button>{/if}
                  </li>
                {/each}
              </ul>
            {/if}

            <h3>{tr('svgImport.fontsHeading')}</h3>
            {#if a.report.fonts.length}
              <table aria-label={tr('svgImport.fontsHeading')}>
                <thead><tr><th scope="col">{tr('svgImport.fontFamily')}</th><th scope="col">{tr('svgImport.fontStatus')}</th><th scope="col">{tr('svgImport.fontMapTo')}</th></tr></thead>
                <tbody>
                  {#each a.report.fonts as f}
                    <tr>
                      <td>{f.family}</td>
                      <td>{#if f.status === 'available'}<span class="ok">{tr('svgImport.fontAvailable')}</span>{:else}<span class="warn">{tr('svgImport.fontMissing')}</span>{/if}</td>
                      <td>{#if f.status === 'missing'}
                        <select bind:value={fontMap[f.family]} aria-label={tr('svgImport.fontMapLabel', { family: f.family })}>
                          <option value="">{tr('svgImport.fontKeep')}</option>
                          {#each mapOptions() as o}<option value={o}>{o}</option>{/each}
                        </select>{/if}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              {#if missingFonts.length}<p class="dim small">{tr('svgImport.fontHelp')}</p>{/if}
            {:else}<p class="dim">{tr('svgImport.noFonts')}</p>{/if}

            {#if a.outlined.length}
              <h3>{tr('svgImport.outlinedHeading')}</h3>
              <p>{tr('svgImport.outlinedText', { names: a.outlined.map(o => o.name).join(', ') })}</p>
              <p class="dim small">{tr('svgImport.outlinedHelp')}</p>
            {/if}

            {#if unsupportedLines.length || a.report.complex}
              <h3>{tr('svgImport.unsupportedHeading')}</h3>
              <ul>
                {#each unsupportedLines as [kind, n]}<li>{unsupportedText(kind, n)}</li>{/each}
                {#if a.report.complex}<li>{tr('svgImport.complexWarning', { n: a.report.elementCount })}</li>{/if}
              </ul>
              {#if unsupportedLines.length}<p class="dim small">{tr('svgImport.unsupportedHelp')}</p>{/if}
            {/if}
          </section>
        {:else}
          <section aria-label={tr('svgImport.stepBinding')}>
            {#if a.reimport}
              <div class="changes">
                <h3>{tr('svgImport.changesHeading')}</h3>
                {#each [['added', a.reimport.changes.added], ['removed', a.reimport.changes.removed], ['moved', a.reimport.changes.moved], ['restyled', a.reimport.changes.restyled]] as [kind, list]}
                  {#if list.length}<p><strong>{kind === 'added' ? tr('svgImport.changeAdded') : kind === 'removed' ? tr('svgImport.changeRemoved') : kind === 'moved' ? tr('svgImport.changeMoved') : tr('svgImport.changeRestyled')}</strong> {list.join(', ')}</p>{/if}
                {/each}
                {#if !a.reimport.changes.added.length && !a.reimport.changes.removed.length && !a.reimport.changes.moved.length && !a.reimport.changes.restyled.length}<p class="dim">{tr('svgImport.noChanges')}</p>{/if}
                {#if a.reimport.removed.length}
                  <p class="dim small">{tr('svgImport.removedBindingsHelp')}</p>
                  <ul class="plain">{#each a.reimport.removed as r}<li><label><input type="checkbox" bind:checked={keep[r.id]} /> {tr('svgImport.keepRemoved', { name: r.name || r.id })}</label></li>{/each}</ul>
                {/if}
                <p class="dim small">{tr('svgImport.reimportReplaces')}</p>
              </div>
            {/if}
            <div class="toolbar">
              <button type="button" on:click={() => setAll('exact')}>{tr('svgImport.acceptExact')}</button>
              <button type="button" on:click={() => setAll('all')}>{tr('svgImport.acceptAll')}</button>
              <button type="button" on:click={() => setAll('none')}>{tr('svgImport.acceptNone')}</button>
              <span class="dim small" role="status">{tr('svgImport.checkedCount', { n: checkedCount(), total: a.rows.length })}</span>
            </div>
            {#if !a.rows.length}<p class="dim">{tr('svgImport.noCandidates')}</p>{:else}
              <table class="rows" aria-label={tr('svgImport.stepBinding')}>
                <thead><tr>
                  <th scope="col"><span class="sr-only">{tr('svgImport.colBind')}</span></th><th scope="col"><span class="sr-only">{tr('svgImport.colThumb')}</span></th>
                  <th scope="col">{tr('svgImport.colName')}</th><th scope="col">{tr('svgImport.colType')}</th><th scope="col">{tr('svgImport.colField')}</th><th scope="col">{tr('svgImport.colConfidence')}</th>
                </tr></thead>
                <tbody>
                  {#each a.rows as r (r.key)}
                    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
                    <tr class:selected={selectedKey === r.key} on:click={() => (selectedKey = r.key)}>
                      <td><input type="checkbox" bind:checked={state[r.key].checked} aria-label={tr('svgImport.bindRow', { name: rowName(r) })} on:focus={() => (selectedKey = r.key)} /></td>
                      <td>{#if r.thumb}<img class="thumb" src="data:image/png;base64,{r.thumb}" alt="" />{/if}</td>
                      <td>{rowName(r)}{#if r.kind === 'text' && r.sample && r.name}<div class="dim small">“{r.sample.slice(0, 40)}”</div>{/if}</td>
                      <td>{typeLabel(r)}</td>
                      <td>
                        {#if isFixed(r)}<span>{fixedLabel(r)}</span>
                        {:else}
                          <select bind:value={state[r.key].choice} on:change={() => (state[r.key].checked = state[r.key].choice !== 'none')} on:focus={() => (selectedKey = r.key)} aria-label={tr('svgImport.fieldFor', { name: rowName(r) })}>
                            <option value="none">{tr('svgImport.dontBind')}</option>
                            {#each optionsOf(r) as f}<option value="field:{f.slug}">{f.name}</option>{/each}
                            <option value="new">{tr('svgImport.createNew')}</option>
                            {#if r.kind === 'text'}<option value="free">{tr('svgImport.freeText')}</option>{/if}
                          </select>
                          {#if state[r.key].choice === 'free'}
                            <textarea class="field newname" rows="2" bind:value={state[r.key].freeText} aria-label={tr('svgImport.freeTextFor', { name: rowName(r) })}></textarea>
                          {/if}
                          {#if state[r.key].choice === 'new'}
                            <input class="field newname" bind:value={state[r.key].newName} aria-label={tr('svgImport.newFieldName', { name: rowName(r) })} />
                          {/if}
                        {/if}
                      </td>
                      <td class="dim small">{confidenceLabel(r)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
            <details bind:open={guideOpen} class="guide">
              <summary>{tr('svgImport.guideTitle')}</summary>
              <p>{tr('svgImport.guideIntro')}</p>
              <ul>
                <li>{tr('svgImport.guideNames')}</li>
                <li>{tr('svgImport.guideBox')}</li>
                <li>{tr('svgImport.guideConditions')}</li>
                <li>{tr('svgImport.guideIcons')}</li>
                <li>{tr('svgImport.guideText')}</li>
                <li>{tr('svgImport.guideImages')}</li>
                <li>{tr('svgImport.guideFigma')}</li>
                <li>{tr('svgImport.guideIllustrator')}</li>
                <li>{tr('svgImport.guideInkscape')}</li>
                <li>{tr('svgImport.guideAffinity')}</li>
              </ul>
            </details>
          </section>
        {/if}
      </div>
    </div>
  {/if}

  <svelte:fragment slot="footer">
    <button type="button" on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
    {#if paths.length > 1}<button type="button" on:click={skip} disabled={busy}>{tr('svgImport.skipFile')}</button>{/if}
    <span style="flex:1" />
    {#if step > 0}<button type="button" on:click={() => step--} disabled={busy}>{tr('svgImport.back')}</button>{/if}
    {#if step < 2}
      <button type="button" class="primary" on:click={() => step++} disabled={!canNext}>{tr('svgImport.next')}</button>
    {:else}
      <button type="button" class="primary" on:click={finish} disabled={!canNext}>{reimport ? tr('svgImport.reimportButton') : tr('svgImport.importButton')}</button>
    {/if}
  </svelte:fragment>
</Modal>

<style>
  .head { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
  .file { font-weight: 600; }
  .steps { display: flex; gap: 12px; list-style: none; margin: 0 0 0 auto; padding: 0; font-size: 12px; color: var(--color-text-dim); }
  .steps .current { color: var(--color-text); font-weight: 600; border-bottom: 2px solid var(--color-accent-text); }
  .body { display: flex; gap: 16px; align-items: flex-start; }
  .side { width: 300px; flex: none; position: sticky; top: 0; }
  .preview { position: relative; border: 1px solid var(--color-border); background: repeating-conic-gradient(#8884 0 25%, transparent 0 50%) 0 0 / 14px 14px; }
  .preview img { display: block; width: 100%; height: auto; }
  .hl { position: absolute; outline: 2px solid var(--color-accent-text); background: #ffd40044; pointer-events: none; }
  .main { flex: 1; min-width: 0; max-height: 62vh; overflow: auto; padding-right: 4px; }
  h3 { font-size: 13px; margin: 14px 0 4px; }
  .stack { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-dim); font-size: 11px; margin: 8px 0; }
  .note { border-left: 3px solid var(--color-accent-text); padding-left: 8px; font-size: 12px; margin: 8px 0; }
  .dim { color: var(--color-text-dim); }
  .small { font-size: 11px; }
  .ok { color: var(--color-success-text); }
  .warn { color: var(--color-warning-text); }
  .error { color: var(--color-danger-text); margin-bottom: 8px; }
  .mono { font-family: monospace; font-size: 11px; word-break: break-all; }
  .fit { border: 1px solid var(--color-border); padding: 6px 10px; margin: 10px 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .bleed span { display: flex; align-items: center; gap: 4px; }
  .bleed input { width: 70px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
  tr.selected { background: var(--color-selected, #8883); }
  .thumb { width: 40px; height: 40px; object-fit: contain; background: #8882; display: block; }
  .newname { margin-top: 3px; width: 100%; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
  .toolbar .small { margin-left: auto; }
  .changes { border: 1px solid var(--color-border); padding: 4px 10px; margin-bottom: 8px; font-size: 12px; }
  ul.plain { list-style: none; padding: 0; margin: 4px 0; }
  .guide { margin-top: 12px; font-size: 12px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
