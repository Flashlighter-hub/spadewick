<script>
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher, onMount, onDestroy } from 'svelte'
  import Modal from './Modal.svelte'
  import ProductionPanel from './ProductionPanel.svelte'
  import ImageExportPanel from './ImageExportPanel.svelte'
  import { showMe } from '../stores/ui.js'
  import { sets, activeSetId, selectedCardIds } from '../stores/project.js'
  import { toast } from '../stores/ui.js'
  import { CARD_SIZES } from '../../../shared/cardSizes.js'

  export let visible = false
  export let initialTab = 'tts'  // 'tts' | 'pdf' | 'png'

  const dispatch = createEventDispatcher()

  let activeExportTab = initialTab
  $: activeExportTab = initialTab

  // Common
  let selectedSetIds = []
  let outputDir = ''
  let cardSelection = 'all'      // 'all' | 'selected' | 'filter' (PRD §10.1)
  let cardFilter = ''
  // Only the final cards (UPDATES U26) is a filter the dialog writes itself; the others are typed or taken from a saved view (UPDATES U25)
  const FINAL_ONLY = "status == 'final'"
  $: effectiveFilter = cardSelection === 'filter' ? cardFilter : cardSelection === 'final' ? FINAL_ONLY : undefined
  let savedViews = []
  $: if (cardSelection === 'filter' && selectedSetIds[0]) window.spadewick.views.list(selectedSetIds[0]).then(v => { savedViews = v }).catch(() => { savedViews = [] })
  $: tracksStatus = $sets.some(x => selectedSetIds.includes(x.id) && x.status_mode >= 1)
  let fileNameTemplate = '{{set_name}}'
  let cardBackMode = 'template'   // 'template' (the set's card back) | 'none' | 'color' | 'asset'
  let backAssets = []
  // Sets with no card back of their own: with "the set's card back" chosen, a plain colour is printed on their cards (PRD §7.8)
  $: setsWithoutBack = $sets.filter(x => selectedSetIds.includes(x.id) && !x.default_back_template_id)
  let cardBackColor = '#1a1a2e'
  let cardBackAssetId = ''

  // TTS options
  let ttsGenerateJson = true
  let ttsDisplayNameField = ''
  let ttsDescriptionField = ''
  let ttsImageLinks = 'local'   // 'local' | 'names' | 'cloud' (PRD §10.2.1, §10.2.4); remembered in the settings
  onMount(async () => { try { const m = await window.spadewick.settings.get('tts_image_links'); if (m === 'names' || m === 'cloud') ttsImageLinks = m } catch { /* the default is fine */ } })
  // Steam Cloud addresses typed for the sheets of the last TTS export (PRD §10.2.4)
  let cloudLinks = {}
  let cloudDone = null
  let cloudError = null
  async function writeCloudJson() {
    cloudError = null; cloudDone = null
    try { cloudDone = await window.spadewick.export.ttsCloudLinks({ jsonFile: lastResult.jsonFile, links: cloudLinks }) }
    catch (err) { cloudError = String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }
  }

  // PDF mode (PRD §17.3): printing at home, or a production file for a manufacturer
  let pdfMode = 'play'          // 'play' | 'production'
  let panel
  let prodProgress = null
  let preflight = null          // the latest preflight of the production settings
  let exportAnyway = false
  let progressTimer
  $: prodSelection = { setIds: selectedSetIds, cardIds: cardSelection === 'selected' ? [...$selectedCardIds] : undefined, filter: effectiveFilter }
  $: production = activeExportTab === 'pdf' && pdfMode === 'production'
  $: images = activeExportTab === 'png' && pngMode === 'service'
  $: blocked = (production || images) && !!preflight && preflight.counts.error > 0 && !exportAnyway   // errors stop the export unless the person insists (PRD §17.3)

  // PDF options
  let pdfCardSize = 'set'     // 'set' (use the set's size), preset id, or 'custom'
  let pdfCustomMmW = 63.5
  let pdfCustomMmH = 88.9
  let pdfPageSize = 'letter'
  let pdfPageMmW = 210
  let pdfPageMmH = 297
  let pdfGridMode = 'auto'
  let pdfGridCols = 3
  let pdfGridRows = 3
  let pdfScale = 'actual'
  let pdfBleedColor = '#000000'
  let pdfBleedAuto = true
  let pdfDpi = 300
  let pdfMarginMm = 10
  let pdfGapMm = 3
  let pdfFitMore = true
  let pdfBleedMm = 0
  let pdfCropMarks = false
  let pdfLandscape = false
  let pdfCardBacks = false

  // PNG options
  let pngMode = 'sheet'          // 'sheet' | 'service' (per-card images for a print service, PRD §18)
  let imagePanel
  let pngCardsPerRow = 10
  let pngPaddingPx = 4
  let pngBackgroundColor = '#000000'
  let pngIndividualFiles = false

  let exporting = false
  let lastResult = null
  let errorMsg = null

  $: if (visible) window.spadewick.assets.list({}).then(l => backAssets = l)
  $: if (visible && $sets.length && !selectedSetIds.length) {
    selectedSetIds = $activeSetId ? [$activeSetId] : [$sets[0]?.id].filter(Boolean)
  }

  function toggleSet(id) {
    selectedSetIds = selectedSetIds.includes(id)
      ? selectedSetIds.filter(s => s !== id)
      : [...selectedSetIds, id]
  }

  async function pickOutputDir() {
    const picked = await window.spadewick.app.pickDirectory(outputDir || undefined)
    if (picked) outputDir = picked
  }

  // The options that both the export and its preview read (PRD §10.7)
  $: pickedOpts = {
    setIds: selectedSetIds,
    cardIds: cardSelection === 'selected' ? [...$selectedCardIds] : undefined,
    filter: effectiveFilter,
    cardBack:        cardBackMode,
    cardBackColor:   cardBackMode === 'color' || cardBackMode === 'template' ? cardBackColor : undefined,
    cardBackAssetId: cardBackMode === 'asset' ? cardBackAssetId : undefined,
  }
  $: ttsOpts = {
    generateJson:       ttsGenerateJson,
    displayNameField:   ttsDisplayNameField || undefined,
    descriptionField:   ttsDescriptionField || undefined,
    imageLinks:         ttsImageLinks,
  }
  $: pdfOpts = {
    cardSize:  pdfCardSize,
    ...(pdfCardSize === 'custom' ? { cardMmW: pdfCustomMmW, cardMmH: pdfCustomMmH } : {}),
    pageSize:  pdfPageSize,
    ...(pdfPageSize === 'custom' ? { pageMmW: pdfPageMmW, pageMmH: pdfPageMmH } : {}),
    ...(pdfGridMode === 'manual' ? { cardsPerRow: pdfGridCols, cardsPerColumn: pdfGridRows } : {}),
    scale:     pdfScale,
    bleedColor: pdfBleedMm > 0 && !pdfBleedAuto ? pdfBleedColor : undefined,
    dpi:       pdfDpi,
    marginMm:  pdfMarginMm,
    gapMm:     pdfGapMm,
    fitMore:   pdfFitMore,
    bleedMm:   pdfBleedMm,
    cropMarks: pdfCropMarks,
    landscape: pdfLandscape,
    cardBacks: pdfCardBacks && cardBackMode !== 'none',
  }
  $: pngOpts = {
    cardsPerRow:      pngCardsPerRow,
    paddingPx:        pngPaddingPx,
    backgroundColor:  pngBackgroundColor,
    individualFiles:  pngIndividualFiles,
  }

  // The live preview (PRD §10.7): the first sheet or page, made by the export itself a moment after the last change
  $: showPreview = !production && !images
  $: previewRequest = { kind: activeExportTab, options: { ...pickedOpts, ...(activeExportTab === 'tts' ? ttsOpts : activeExportTab === 'pdf' ? pdfOpts : pngOpts) } }
  let preview = null
  let previewBusy = false
  let previewTimer
  let previewSeq = 0
  let previewKey = ''
  function queuePreview(request) {
    const key = JSON.stringify(request)
    if (key === previewKey) return
    previewKey = key
    clearTimeout(previewTimer)
    if (!request.options.setIds.length) { previewSeq++; preview = null; previewBusy = false; return }
    previewBusy = true
    previewTimer = setTimeout(async () => {
      const seq = ++previewSeq
      let result
      try { result = await window.spadewick.export.preview(request) } catch (err) { result = { kind: request.kind, error: String(err?.message ?? err) } }
      if (seq !== previewSeq) return                                       // a newer change has been asked for
      preview = result
      previewBusy = false
    }, 450)
  }
  $: if (visible && showPreview) queuePreview(previewRequest)
  onDestroy(() => { clearTimeout(previewTimer); previewSeq++ })
  const previewLabel = part => part === 'sheet' ? tr('exportDialog.previewLabel.sheet') : part === 'back' && preview?.kind === 'pdf' ? tr('exportDialog.previewLabel.backPage') : part === 'back' ? tr('exportDialog.previewLabel.back') : part === 'front' ? tr('exportDialog.previewLabel.front') : tr('exportDialog.previewLabel.card')
  $: previewFacts = preview?.facts
    ? preview.kind === 'tts' ? tr('exportDialog.previewFactsTts', { cards: preview.facts.cards, decks: preview.facts.decks, set: preview.facts.set, cols: preview.facts.cols, rows: preview.facts.rows, w: preview.facts.cellWidth, h: preview.facts.cellHeight, scale: preview.facts.scale.toFixed(2) })
    : preview.kind === 'pdf' ? tr('exportDialog.previewFactsPdf', { cards: preview.facts.cards, pages: preview.facts.pageCount, perPage: preview.facts.perPage, cols: preview.facts.cols, rows: preview.facts.rows, w: preview.facts.pageWidthMm, h: preview.facts.pageHeightMm })
      + (preview.facts.tightened ? ' ' + tr('exportDialog.previewTightened', { margin: preview.facts.marginMm, gap: preview.facts.gapMm }) : '')
      + (preview.facts.sizes > 1 ? ' ' + tr('exportDialog.previewSizes', { n: preview.facts.sizes }) : '')
    : preview.facts.individual ? tr('exportDialog.previewFactsPngEach', { cards: preview.facts.cards })
    : tr('exportDialog.previewFactsPng', { cards: preview.facts.cards, shown: preview.facts.shownCards })
    : ''

  async function runExport() {
    if (!selectedSetIds.length) { errorMsg = 'Select at least one set.'; return }
    exporting = true
    errorMsg = null
    lastResult = null

    const common = { ...pickedOpts, outputDir: outputDir || undefined, fileNameTemplate: fileNameTemplate || undefined }

    try {
      if (activeExportTab === 'tts') {
        cloudLinks = {}; cloudDone = null; cloudError = null
        lastResult = await window.spadewick.export.tts({ ...common, ...ttsOpts })
      } else if (production) {
        progressTimer = setInterval(async () => { try { prodProgress = await window.spadewick.production.status() } catch { /* the export is still running */ } }, 400)
        lastResult = await window.spadewick.production.run({ ...common, ...panel.options() })
        lastResult.production = true
      } else if (images) {
        progressTimer = setInterval(async () => { try { prodProgress = await window.spadewick.production.status() } catch { /* the export is still running */ } }, 400)
        lastResult = await window.spadewick.production.runImages({ ...common, ...imagePanel.options() })
        lastResult.images = true
      } else if (activeExportTab === 'pdf') {
        lastResult = await window.spadewick.export.pdf({ ...common, ...pdfOpts })
      } else {
        lastResult = await window.spadewick.export.pngSheet({ ...common, ...pngOpts })
      }
      toast(tr('exportDialog.exportedToast', { n: lastResult.cardCount, path: lastResult.outputDir }), 'success', 4000)
    } catch (err) {
      errorMsg = err.message
    } finally {
      clearInterval(progressTimer)
      prodProgress = null
      exporting = false
    }
  }

  const cancelExport = () => window.spadewick.production.cancel()

  function close() {
    visible = false
    dispatch('close')
  }

</script>

{#if visible}
<Modal title="{tr('common.export2')}" width={production || images ? 820 : 980} on:close={close}>
      <!-- Export target tabs -->
      <div class="tab-bar" role="tablist" aria-label="{tr('exportDialog.exportTarget')}">
        <button role="tab" id="export-tab-tts" aria-selected={activeExportTab === 'tts'} aria-controls="export-panel" class:active={activeExportTab === 'tts'} on:click={() => activeExportTab = 'tts'}>
          {tr('exportDialog.tabletopSimulator')}
        </button>
        <button role="tab" id="export-tab-pdf" aria-selected={activeExportTab === 'pdf'} aria-controls="export-panel" class:active={activeExportTab === 'pdf'} on:click={() => activeExportTab = 'pdf'}>
          {tr('exportDialog.printPdf')}
        </button>
        <button role="tab" id="export-tab-png" aria-selected={activeExportTab === 'png'} aria-controls="export-panel" class:active={activeExportTab === 'png'} on:click={() => activeExportTab = 'png'}>
          {tr('exportDialog.pngSheet')}
        </button>
      </div>

      <div class="split">
      <div class="dialog-body" id="export-panel" role="tabpanel" aria-labelledby="export-tab-{activeExportTab}">
        <!-- === Common: Set selection === -->
        <section>
          <span class="section-label">{tr('exportDialog.setsToExport')}</span>
          <div class="set-list">
            {#each $sets as set (set.id)}
              <label class="set-item">
                <input
                  type="checkbox"
                  checked={selectedSetIds.includes(set.id)}
                  on:change={() => toggleSet(set.id)}
                />
                {set.name}
              </label>
            {/each}
            {#if !$sets.length}
              <span class="dim">{tr('exportDialog.noSetsInThisProject')}</span>
            {/if}
          </div>
        </section>

        <!-- === Common: Card selection === -->
        <section>
          <span class="section-label">{tr('common.cards')}</span>
          <div class="row">
            <label><input type="radio" bind:group={cardSelection} value="all" /> {tr('exportDialog.allCards')}</label>
            <label><input type="radio" bind:group={cardSelection} value="selected" disabled={!$selectedCardIds.length} /> {tr('exportDialog.selectedCards', { n: $selectedCardIds.length })}</label>
            {#if tracksStatus}<label><input type="radio" bind:group={cardSelection} value="final" /> {tr('exportDialog.finalOnly')}</label>{/if}
            <label><input type="radio" bind:group={cardSelection} value="filter" /> {tr('exportDialog.matchingAFilter')}</label>
          </div>
          {#if cardSelection === 'filter'}
            <div class="row">
              <input class="dir-input" bind:value={cardFilter} placeholder="{tr('exportDialog.eGFactionRed')}" aria-label="{tr('exportDialog.cardFilterExpression')}" />
              {#if savedViews.length}
                <select aria-label="{tr('exportDialog.useSavedView')}" value="" on:change={e => { const v = savedViews.find(x => x.id === e.target.value); if (v) cardFilter = v.filter; e.target.value = '' }}>
                  <option value="">{tr('exportDialog.useSavedView')}</option>
                  {#each savedViews as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
                </select>
              {/if}
            </div>
          {:else if cardSelection === 'final'}
            <span class="dim">{tr('exportDialog.finalOnlyHint')}</span>
          {/if}
        </section>

        <!-- === Common: Output directory === -->
        <section>
          <span class="section-label">{tr('exportDialog.outputDirectory')}</span>
          <div class="row">
            <input
              class="dir-input"
              value={outputDir}
              placeholder="{tr('exportDialog.projectExportsFolder')}"
              on:input={e => outputDir = e.target.value}
            />
            <button on:click={pickOutputDir}>{tr('exportDialog.browse')}</button>
          </div>
        </section>

        <section>
          <span class="section-label">{tr('exportDialog.fileName')}</span>
          <div class="row">
            <input class="dir-input" bind:value={fileNameTemplate} placeholder={'{{set_name}}_{{date}}'} aria-label="{tr('exportDialog.fileNamePattern')}" />
          </div>
          <span class="dim">{tr('exportDialog.use')}</span>
        </section>

        <!-- === Common: Card back === -->
        <fieldset>
          <legend class="section-label">{tr('exportDialog.cardBack')}</legend>
          <div class="row">
            <label><input type="radio" bind:group={cardBackMode} value="template" /> {tr('exportDialog.setBack')}</label>
            <label><input type="radio" bind:group={cardBackMode} value="none" /> {tr('exportDialog.none2')}</label>
            <label><input type="radio" bind:group={cardBackMode} value="color" /> {tr('exportDialog.solidColor')}</label>
            <label><input type="radio" bind:group={cardBackMode} value="asset" /> {tr('exportDialog.image')}</label>
          </div>
          {#if cardBackMode === 'template'}
            <span class="dim">{tr('exportDialog.setBackHint')}</span>
            {#if setsWithoutBack.length}
              <span class="dim" role="note">{tr('exportDialog.setsWithoutBack', { names: setsWithoutBack.map(x => x.name).join(', ') })}</span>
              <div class="row">
                <input type="color" bind:value={cardBackColor} aria-label="{tr('exportDialog.cardBackColor')}" />
                <span class="dim">{cardBackColor}</span>
              </div>
            {/if}
          {:else if cardBackMode === 'color'}
            <div class="row">
              <input type="color" bind:value={cardBackColor} aria-label="{tr('exportDialog.cardBackColor')}" />
              <span class="dim">{cardBackColor}</span>
            </div>
          {:else if cardBackMode === 'asset'}
            <select bind:value={cardBackAssetId} aria-label="{tr('exportDialog.cardBackImage')}">
              <option value="">{tr('exportDialog.chooseAnImage')}</option>
              {#each backAssets as a (a.id)}<option value={a.id}>{a.original_name}</option>{/each}
            </select>
          {:else}
            <span class="dim">{tr('exportDialog.tabletopSimulatorGetsATransparent')}</span>
          {/if}
        </fieldset>

        <!-- === TTS-specific options === -->
        {#if activeExportTab === 'tts'}
          <section>
            <span class="section-label">{tr('exportDialog.ttsOptions')}</span>
            <label class="row">
              <input type="checkbox" bind:checked={ttsGenerateJson} />
              {tr('exportDialog.generateJsonCompanionFile')}
            </label>
            <label class="row"><span class="field-label">{tr('exportDialog.displayNameFieldSlug')}</span><input bind:value={ttsDisplayNameField} placeholder="{tr('exportDialog.usesCardName')}" aria-label="{tr('exportDialog.nameFieldToken')}" /></label>
            <label class="row"><span class="field-label">{tr('exportDialog.descriptionFieldSlug')}</span><input bind:value={ttsDescriptionField} placeholder="{tr('exportDialog.none')}" aria-label="{tr('exportDialog.descriptionFieldToken')}" /></label>
            {#if ttsGenerateJson}
              <label class="row"><span class="field-label">{tr('exportDialog.imageLinks')}</span>
                <select bind:value={ttsImageLinks} on:change={() => window.spadewick.settings.set('tts_image_links', ttsImageLinks)} aria-describedby="tts-links-help">
                  <option value="local">{tr('exportDialog.imageLinksLocal')}</option>
                  <option value="names">{tr('exportDialog.imageLinksNames')}</option>
                  <option value="cloud">{tr('exportDialog.imageLinksCloud')}</option>
                </select>
              </label>
              <p class="dim" id="tts-links-help">{ttsImageLinks === 'local' ? tr('exportDialog.imageLinksLocalHelp') : ttsImageLinks === 'cloud' ? tr('exportDialog.imageLinksCloudHelp') : tr('exportDialog.imageLinksNamesHelp')}</p>
              <p class="dim">{tr('exportDialog.imageLinksHowTo')}</p>
            {/if}
          </section>

        <!-- === PDF-specific options === -->
        {:else if activeExportTab === 'pdf'}
          <fieldset>
            <legend class="section-label">{tr('exportDialog.pdfMode')}</legend>
            <div class="row">
              <label><input type="radio" bind:group={pdfMode} value="play" /> {tr('exportDialog.modePlay')}</label>
              <label><input type="radio" bind:group={pdfMode} value="production" /> {tr('exportDialog.modeProduction')}</label>
            </div>
          </fieldset>
          {#if pdfMode === 'production'}
            <ProductionPanel bind:this={panel} bind:exportAnyway selection={{ ...prodSelection, cardBack: cardBackMode, cardBackColor: cardBackMode === 'color' || cardBackMode === 'template' ? cardBackColor : undefined, cardBackAssetId: cardBackMode === 'asset' ? cardBackAssetId : undefined }}
              on:preflight={e => (preflight = e.detail)} on:show={e => { close(); showMe(e.detail) }} />
          {:else}
          <section>
            <label class="section-label" for="pdf-card-size">{tr('exportDialog.cardSize')}</label>
            <div class="row">
              <select id="pdf-card-size" bind:value={pdfCardSize}>
                <option value="set">{tr('exportDialog.useSetSCardSize')}</option>
                {#each CARD_SIZES as size}
                  <option value={size.id}>{tr(`cardSizes.${size.id}`)}</option>
                {/each}
                <option value="custom">{tr('common.custom')}</option>
              </select>
              {#if pdfCardSize === 'custom'}
                <input type="number" bind:value={pdfCustomMmW} min="10" max="300" step="0.1" style="width:70px" aria-label="{tr('exportDialog.cardWidthMm')}" /> ×
                <input type="number" bind:value={pdfCustomMmH} min="10" max="300" step="0.1" style="width:70px" aria-label="{tr('exportDialog.cardHeightMm')}" /> {tr('common.mm')}{/if}
            </div>
          </section>
          <section>
            <label class="section-label" for="pdf-page-size">{tr('exportDialog.pageSize')}</label>
            <div class="row">
              <select id="pdf-page-size" bind:value={pdfPageSize}>
                <option value="letter">{tr('exportDialog.letter8511In')}</option>
                <option value="a4">{tr('exportDialog.a4210297Mm')}</option>
                <option value="a3">{tr('exportDialog.a3297420Mm')}</option>
                <option value="legal">{tr('exportDialog.legal8514In')}</option>
                <option value="custom">{tr('common.custom')}</option>
              </select>
              {#if pdfPageSize === 'custom'}
                <input type="number" bind:value={pdfPageMmW} min="50" max="1500" step="1" style="width:70px" aria-label="{tr('exportDialog.pageWidthMm')}" /> ×
                <input type="number" bind:value={pdfPageMmH} min="50" max="1500" step="1" style="width:70px" aria-label="{tr('exportDialog.pageHeightMm')}" /> {tr('common.mm')}{/if}
              <label><input type="checkbox" bind:checked={pdfLandscape} /> {tr('exportDialog.landscape')}</label>
            </div>
          </section>
          <fieldset>
            <legend class="section-label">{tr('exportDialog.cardsPerPage')}</legend>
            <div class="row">
              <label><input type="radio" bind:group={pdfGridMode} value="auto" /> {tr('exportDialog.autoFit')}</label>
              <label><input type="radio" bind:group={pdfGridMode} value="manual" /> {tr('exportDialog.manualGrid')}</label>
              {#if pdfGridMode === 'manual'}
                <input type="number" bind:value={pdfGridCols} min="1" max="20" style="width:56px" aria-label="{tr('exportDialog.columns')}" /> ×
                <input type="number" bind:value={pdfGridRows} min="1" max="20" style="width:56px" aria-label="{tr('exportDialog.rows')}" />
              {/if}
            </div>
          </fieldset>
          <fieldset>
            <legend class="section-label">{tr('exportDialog.scale')}</legend>
            <div class="row">
              <label><input type="radio" bind:group={pdfScale} value="actual" /> {tr('exportDialog.printAt100TrueSize')}</label>
              <label><input type="radio" bind:group={pdfScale} value="fit" /> {tr('exportDialog.fitToPage')}</label>
            </div>
          </fieldset>
          <section>
            <span class="section-label">{tr('exportDialog.printSettings')}</span>
            <label class="row"><span class="field-label">{tr('exportDialog.dpi')}</span>
              <select bind:value={pdfDpi}><option value={150}>150</option><option value={300}>300</option><option value={600}>600</option></select>
            </label>
            <label class="row"><span class="field-label">{tr('exportDialog.marginMm')}</span>
              <input type="number" bind:value={pdfMarginMm} min="0" max="50" step="0.5" style="width:70px" />
            </label>
            <label class="row"><span class="field-label">{tr('exportDialog.gapBetweenCardsMm')}</span>
              <input type="number" bind:value={pdfGapMm} min="0" max="20" step="0.5" style="width:70px" />
            </label>
            {#if pdfGridMode === 'auto' && pdfScale === 'actual'}
              <label class="row"><input type="checkbox" bind:checked={pdfFitMore} aria-describedby="pdf-fit-more-help" /> {tr('exportDialog.fitMore')}</label>
              <p class="dim" id="pdf-fit-more-help">{tr('exportDialog.fitMoreHelp')}</p>
            {/if}
            <label class="row"><span class="field-label">{tr('exportDialog.bleedMm')}</span>
              <input type="number" bind:value={pdfBleedMm} min="0" max="10" step="0.5" style="width:70px" />
            </label>
            {#if pdfBleedMm > 0}
              <label class="row"><span class="field-label">{tr('exportDialog.bleedColor')}</span>
                <input type="color" bind:value={pdfBleedColor} disabled={pdfBleedAuto} aria-label="{tr('exportDialog.bleedColor')}" />
                <label><input type="checkbox" bind:checked={pdfBleedAuto} /> {tr('exportDialog.useTheCardSEdge')}</label>
              </label>
            {/if}
            <label class="row">
              <input type="checkbox" bind:checked={pdfCropMarks} /> {tr('exportDialog.cropMarks')}
            </label>
            <label class="row">
              <input type="checkbox" bind:checked={pdfCardBacks} disabled={cardBackMode === 'none'} /> {tr('exportDialog.includeCardBacksDuplex')}
            </label>
          </section>
          {/if}

        <!-- === PNG-specific options === -->
        {:else}
          <fieldset>
            <legend class="section-label">{tr('exportDialog.pngMode')}</legend>
            <div class="row">
              <label><input type="radio" bind:group={pngMode} value="sheet" /> {tr('exportDialog.pngSheetMode')}</label>
              <label><input type="radio" bind:group={pngMode} value="service" /> {tr('exportDialog.pngServiceMode')}</label>
            </div>
          </fieldset>
          {#if pngMode === 'service'}
            <ImageExportPanel bind:this={imagePanel} bind:exportAnyway setId={selectedSetIds[0]}
              selection={{ ...prodSelection, cardBack: cardBackMode, cardBackColor: cardBackMode === 'color' || cardBackMode === 'template' ? cardBackColor : undefined, cardBackAssetId: cardBackMode === 'asset' ? cardBackAssetId : undefined }}
              on:preflight={e => (preflight = e.detail)} on:show={e => { close(); showMe(e.detail) }} />
          {:else}
          <section>
            <span class="section-label">{tr('exportDialog.pngOptions')}</span>
            <label class="row">
              <input type="checkbox" bind:checked={pngIndividualFiles} />
              {tr('exportDialog.individualFilesPerCard')}
            </label>
            {#if !pngIndividualFiles}
              <label class="row"><span class="field-label">{tr('exportDialog.cardsPerRow')}</span><input type="number" bind:value={pngCardsPerRow} min="1" max="30" step="1" style="width:70px" /></label>
              <label class="row"><span class="field-label">{tr('exportDialog.paddingPx')}</span><input type="number" bind:value={pngPaddingPx} min="0" max="50" step="1" style="width:70px" /></label>
              <label class="row"><span class="field-label">{tr('exportDialog.backgroundColor')}</span><input type="color" bind:value={pngBackgroundColor} /><span class="dim">{pngBackgroundColor}</span></label>
            {/if}
          </section>
          {/if}
        {/if}

        <!-- Result / error -->
        {#if lastResult}
          <div class="result-box">
            <strong>{tr('exportDialog.exportComplete')}</strong> {tr('exportDialog.cardCount', { n: lastResult.cardCount })}<br>
            <span class="dim">{lastResult.outputDir}</span>
            {#if lastResult.imageLinks === 'local'}<br><span class="dim">{tr('exportDialog.linksPointTo')} {lastResult.outputDir}</span>{/if}
            {#if lastResult.cloudFiles}
              <p class="dim">{tr('exportDialog.cloudSteps')}</p>
              {#each lastResult.cloudFiles as f}
                <label class="row"><span class="field-label">{f}</span><input bind:value={cloudLinks[f]} placeholder={tr('exportDialog.cloudAddressHint')} aria-label={tr('exportDialog.cloudAddress', { name: f })} /></label>
              {/each}
              <button class="primary-btn" type="button" on:click={writeCloudJson}>{tr('exportDialog.cloudWrite')}</button>
              {#if cloudDone}<p role="status">{tr('exportDialog.cloudWritten', { n: cloudDone.replaced, file: cloudDone.file })}{#if cloudDone.missing.length}<br><span class="dim">{tr('exportDialog.cloudMissing', { names: cloudDone.missing.join(', ') })}</span>{/if}</p>{/if}
              {#if cloudError}<div role="alert" class="error-box">{cloudError}</div>{/if}
            {/if}
            {#if lastResult.images}
              <ul class="files">{#each lastResult.files as f}<li>{f}</li>{/each}</ul>
              <span class="dim">{tr('exportDialog.imagesSummary', { w: lastResult.pixels.width, h: lastResult.pixels.height })}</span>
            {/if}
            {#if lastResult.production}
              <ul class="files">{#each lastResult.files as f}<li>{f}</li>{/each}</ul>
              <span class="dim">{tr('exportDialog.productionSummary', { pages: lastResult.pageCount, profile: lastResult.report.profile ?? '', ink: lastResult.report.maxInkPct })}</span>
              {#if lastResult.report.inkLimitedPixels}<br><span class="dim">{tr('exportDialog.productionInkLimited', { cards: lastResult.report.cardsOverInk })}</span>{/if}
              {#each Object.keys(lastResult.report.spotPixels) as spot}<br><span class="dim">{tr('exportDialog.productionSpot', { name: spot })}</span>{/each}
              <br><span class="dim">{tr('exportDialog.productionNotChecked')}</span>
            {/if}
          </div>
        {/if}
        {#if errorMsg}
          <div class="error-box">{errorMsg}</div>
        {/if}
      </div>
      {#if showPreview}
        <aside class="preview" aria-labelledby="export-preview-title">
          <span class="section-label" id="export-preview-title">{tr('exportDialog.preview')}</span>
          <div class="preview-area" aria-busy={previewBusy}>
            {#if !selectedSetIds.length}
              <p class="dim">{tr('exportDialog.previewChooseSet')}</p>
            {:else if preview?.error}
              <div class="error-box">{tr('exportDialog.previewFailed', { reason: preview.error })}</div>
            {:else if preview?.empty}
              <p class="dim">{tr('exportDialog.previewNoCards')}</p>
            {:else if preview?.pages}
              <p class="dim">{previewFacts}</p>
              {#each preview.pages as pg (pg.part)}
                <figure class:dimmed={previewBusy} class:small={preview.kind === 'tts' && pg.part === 'back'}>
                  <img src={pg.dataUrl} width={pg.width} height={pg.height} alt={previewLabel(pg.part)} />
                  <figcaption class="dim">{previewLabel(pg.part)}</figcaption>
                </figure>
              {/each}
            {/if}
            <p class="dim" role="status">{previewBusy && selectedSetIds.length ? tr('exportDialog.previewUpdating') : ''}</p>
          </div>
        </aside>
      {/if}
      </div>

  <svelte:fragment slot="footer">
        {#if exporting && (production || images)}
          <span class="dim" role="status">{tr('exportDialog.productionProgress', { done: prodProgress?.done ?? 0, total: prodProgress?.total ?? 0 })}</span>
          <button on:click={cancelExport}>{tr('exportDialog.cancelExport')}</button>
        {:else}
          <button on:click={close}>{tr('common.cancel')}</button>
        {/if}
        <button
          class="primary-btn"
          on:click={runExport}
          disabled={exporting || !selectedSetIds.length || blocked}
        >
          {exporting ? tr('exportDialog.exporting') : tr('exportDialog.export')}
        </button>
      </svelte:fragment>
</Modal>
{/if}

<style>
  fieldset { border: none; padding: 0; margin: 0; min-width: 0; }
  legend { padding: 0; }
  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .tab-bar button {
    flex: 1;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 8px 4px;
    font-size: 12px;
    color: var(--color-text-dim);
    border-radius: 0;
  }

  .tab-bar button.active {
    color: var(--color-text);
    border-bottom-color: var(--color-accent);
  }

  .tab-bar button:hover { background: var(--color-surface-2); }

  .split { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
  .preview { flex: 0 0 380px; max-width: 100%; position: sticky; top: 0; display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
  .preview-area { display: flex; flex-direction: column; gap: 8px; min-height: 120px; }
  .preview figure { margin: 0; display: flex; flex-direction: column; gap: 3px; }
  .preview img { max-width: 100%; height: auto; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface-2); transition: opacity .15s; }
  .preview figure.dimmed img { opacity: .55; }
  .preview figure.small img { max-width: 110px; }
  .dialog-body {
    flex: 1 1 480px;
    min-width: 0;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-dim);
    margin-bottom: 2px;
  }

  .set-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .set-item {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 3px 8px;
    cursor: pointer;
    font-size: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .dir-input { flex: 1; }

  .field-label {
    width: 160px;
    font-size: 12px;
    color: var(--color-text-dim);
    flex-shrink: 0;
  }

  .dim { color: var(--color-text-dim); font-size: 11px; }

  .result-box {
    background: color-mix(in srgb, var(--color-success) 15%, transparent);
    border: 1px solid var(--color-success);
    border-radius: var(--radius);
    padding: 8px 12px;
    font-size: 12px;
    line-height: 1.5;
  }

  .error-box {
    background: color-mix(in srgb, var(--color-danger) 15%, transparent);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius);
    padding: 8px 12px;
    font-size: 12px;
    color: var(--color-danger-text);
  }


  .primary-btn {
    background: var(--color-accent);
    color: #fff;
    border-color: var(--color-accent);
  }

  .primary-btn:hover:not(:disabled) {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
  }

  .primary-btn:disabled { opacity: 0.5; cursor: default; }
</style>
