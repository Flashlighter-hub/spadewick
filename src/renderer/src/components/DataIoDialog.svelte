<script>
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher } from 'svelte'
  import Modal from './Modal.svelte'
  import { project, activeSetId, activeSet, fields, loadSet } from '../stores/project.js'
  import { toast } from '../stores/ui.js'

  export let visible = false
  export let mode = 'import' // 'import' | 'export'

  const dispatch = createEventDispatcher()

  let format = 'csv'
  let file = null            // { fileName, headers, rows, mapping }
  let mapping = {}
  let importMode = 'append'  // 'append' | 'merge'
  let keyField = ''
  let richText = 'markup'   // how text going into a Rich text field is read (PRD §16.7)
  let report = null          // { errors, validCount, newFields }
  let problemsSeen = false   // the person has ticked that they have seen the problems in the file (a CSV that breaks the CSV rules)
  const MAX_PROBLEMS = 50
  let busy = false

  // Export options
  let selectedSetIds = []
  let includeMeta = false

  $: if (visible) init()
  let initialised = false
  function init() {
    if (initialised) return
    initialised = true
    file = null; report = null; mapping = {}
    selectedSetIds = $activeSetId ? [$activeSetId] : []
  }

  function close() {
    initialised = false
    visible = false
    dispatch('close')
  }

  async function chooseFile(sheet) {
    busy = true
    try {
      const res = await window.spadewick.dataio.readFile({ format, setId: $activeSetId, ...(typeof sheet === 'number' ? { sheet } : {}) })
      if (!res) return
      file = res
      problemsSeen = false
      // Every column that matches no field starts as a new text field: the person changes only the ones that need it (UPDATES U8)
      mapping = Object.fromEntries(res.headers.map(h => [h, res.mapping[h] === '__ignore' && h.trim() ? '__new' : res.mapping[h]]))
      // A file that carries card IDs updates the cards it names (PRD §5.8)
      if (Object.values(mapping).includes('__card_id')) importMode = 'merge'
      report = null
      await validate()
    } catch (err) {
      toast(tr('dataIoDialog.couldNotRead', { reason: err.message }), 'error', 5000)
    } finally { busy = false }
  }

  $: hasIdColumn = Object.values(mapping).includes('__card_id')
  $: richMapped = Object.values(mapping).some(slug => $fields.find(f => f.slug === slug)?.type === 'rich_text')

  async function validate() {
    report = await window.spadewick.dataio.import({
      setId: $activeSetId, rows: file.rows, mapping, mode: importMode, keyField, richText, previewOnly: true
    })
  }

  async function commit() {
    busy = true
    try {
      const res = await window.spadewick.dataio.import({
        setId: $activeSetId, rows: file.rows, mapping, mode: importMode, keyField, richText, previewOnly: false
      })
      await loadSet($activeSetId)
      toast(tr('dataIoDialog.importedToast', res), 'info', 4000)
      close()
    } catch (err) {
      toast(tr('dataIoDialog.importFailed', { reason: err.message }), 'error', 5000)
    } finally { busy = false }
  }

  async function doExport() {
    busy = true
    try {
      const res = await window.spadewick.dataio.export({ setIds: selectedSetIds, format, includeMeta })
      if (res) { toast(tr('dataIoDialog.exportedToast', { n: res.count }), 'info', 3000); close() }
    } catch (err) {
      toast(tr('dataIoDialog.exportFailed', { reason: err.message }), 'error', 5000)
    } finally { busy = false }
  }

  function toggleSet(id) {
    selectedSetIds = selectedSetIds.includes(id) ? selectedSetIds.filter(s => s !== id) : [...selectedSetIds, id]
  }
</script>

{#if visible}
  <Modal title={mode === 'import' ? tr('dataIoDialog.importCards') : tr('dataIoDialog.exportCards')} width={620} on:close={close}>
        <label class="row">{tr('dataIoDialog.format')}
          <select bind:value={format} on:change={() => { file = null; report = null }}>
            <option value="csv">{tr('dataIoDialog.csv')}</option>
            <option value="xlsx">{tr('dataIoDialog.xlsx')}</option>
            <option value="json">{tr('dataIoDialog.json')}</option>
          </select>
        </label>

        {#if mode === 'import'}
          <div class="row">
            <button on:click={() => chooseFile()} disabled={busy}>{tr('dataIoDialog.chooseFile', { format: format.toUpperCase() })}</button>
            {#if file}<span class="dim">{tr('dataIoDialog.rows', { file: file.fileName, n: file.rows.length })}</span>{/if}
          </div>

          {#if file}
            <label class="row">{tr('dataIoDialog.importMode')}
              <select bind:value={importMode} on:change={validate}>
                <option value="append">{tr('dataIoDialog.appendAddNewCards')}</option>
                <option value="merge">{tr('dataIoDialog.mergeMatchOnKeyField')}</option>
              </select>
            </label>
            {#if importMode === 'merge'}
              <label class="row">{tr('dataIoDialog.keyField')}
                <select bind:value={keyField} on:change={validate}>
                  <option value="">{hasIdColumn ? tr('dataIoDialog.cardIdAsKey') : tr('dataIoDialog.select')}</option>
                  {#each $fields as f (f.id)}<option value={f.slug}>{f.name}</option>{/each}
                </select>
              </label>
            {/if}

            {#if richMapped}
              <fieldset class="rich-import">
                <legend>{tr('dataIoDialog.richTextImport')}</legend>
                <label><input type="radio" name="rich-import" value="markup" bind:group={richText} on:change={validate} /> {tr('dataIoDialog.richTextMarkup')}</label>
                <label><input type="radio" name="rich-import" value="literal" bind:group={richText} on:change={validate} /> {tr('dataIoDialog.richTextLiteral')}</label>
              </fieldset>
            {/if}

            <p class="dim">{tr('dataIoDialog.newByDefault')}</p>
            <table class="map">
              <thead><tr><th scope="col">{tr('dataIoDialog.sourceColumn')}</th><th scope="col">{tr('dataIoDialog.mapsTo')}</th></tr></thead>
              <tbody>
                {#each file.headers as h}
                  <tr>
                    <td>{h}</td>
                    <td>
                      <select bind:value={mapping[h]} on:change={validate} aria-label="{tr('dataIoDialog.fieldForColumn', { column: h })}">
                        <option value="__ignore">{tr('dataIoDialog.ignore')}</option>
                        <option value="__new">{tr('dataIoDialog.createNewTextField')}</option>
                        <option value="display_name">{tr('dataIoDialog.cardDisplayName')}</option>
                        <option value="__card_id">{tr('dataIoDialog.cardIdOption')}</option>
                        <option value="__quantity">{tr('dataIoDialog.quantityOption')}</option>
                        {#if ($activeSet?.status_mode ?? 0) >= 1}<option value="__status">{tr('dataIoDialog.statusOption')}</option>{/if}
                        {#if ($activeSet?.status_mode ?? 0) >= 2}<option value="__art_status">{tr('dataIoDialog.artStatusOption')}</option>{/if}
                        {#each $fields as f (f.id)}<option value={f.slug}>{f.name}</option>{/each}
                      </select>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>

            {#if file.sheets?.length > 1}
              <label class="row">{tr('dataIoDialog.sheet')}
                <select value={file.sheet} on:change={e => chooseFile(Number(e.target.value))} disabled={busy}>
                  {#each file.sheets as name, i}<option value={i}>{name}</option>{/each}
                </select>
              </label>
            {/if}

            {#if file.issues?.length}
              <div class="report problems" role="alert">
                <div class="err-title">{tr('dataIoDialog.fileProblemsTitle', { n: file.issues.length, rows: file.rows.length })}</div>
                <p class="dim">{tr('dataIoDialog.fileProblemsHow')}</p>
                <table class="errors">
                  <thead><tr><th scope="col">{tr('dataIoDialog.fileProblemsLine')}</th><th scope="col">{tr('dataIoDialog.problem')}</th></tr></thead>
                  <tbody>
                    {#each file.issues.slice(0, MAX_PROBLEMS) as p}
                      <tr><td>{p.line}</td><td>{p.message}</td></tr>
                    {/each}
                  </tbody>
                </table>
                {#if file.issues.length > MAX_PROBLEMS}<p class="dim">{tr('dataIoDialog.fileProblemsMore', { n: file.issues.length - MAX_PROBLEMS })}</p>{/if}
                <label><input type="checkbox" bind:checked={problemsSeen} /> {tr('dataIoDialog.fileProblemsAck')}</label>
              </div>
            {/if}

            {#if report}
              <div class="report">
                <div>{tr('dataIoDialog.validRows', { n: report.validCount }) + (report.newFields.length ? ' · ' + tr('dataIoDialog.newFieldsList', { names: report.newFields.join(', ') }) : '')}</div>
                {#if report.errors.length}
                  <div class="err-title">{tr('dataIoDialog.validationErrorSTheseRows', { n: report.errors.length })}</div>
                  <table class="errors">
                    <thead><tr><th scope="col">{tr('dataIoDialog.row')}</th><th scope="col">{tr('common.field')}</th><th scope="col">{tr('dataIoDialog.problem')}</th></tr></thead>
                    <tbody>
                      {#each report.errors.slice(0, 100) as e}
                        <tr><td>{e.row}</td><td>{e.field}</td><td>{e.message}</td></tr>
                      {/each}
                    </tbody>
                  </table>
                {/if}
              </div>
            {/if}
          {/if}
        {:else}
          <div class="sets">
            {#each $project?.sets ?? [] as s (s.id)}
              <label><input type="checkbox" checked={selectedSetIds.includes(s.id)} on:change={() => toggleSet(s.id)} /> {s.name}</label>
            {/each}
          </div>
          <label><input type="checkbox" bind:checked={includeMeta} /> {tr('dataIoDialog.includeCardMetadataIdSet')}</label>
        {/if}
  <svelte:fragment slot="footer">
        <button on:click={close}>{tr('common.cancel')}</button>
        {#if mode === 'import'}
          <button class="primary" on:click={commit}
            disabled={busy || !file || !report || !report.validCount || (file.issues?.length && !problemsSeen) || (importMode === 'merge' && !keyField && !hasIdColumn)}>
            {report?.errors.length ? tr('dataIoDialog.importSkippingErrors') : tr('dataIoDialog.import')}
          </button>
        {:else}
          <button class="primary" on:click={doExport} disabled={busy || !selectedSetIds.length}>{tr('common.export')}</button>
        {/if}
      </svelte:fragment>
  </Modal>
{/if}

<style>
  .row { display: flex; align-items: center; gap: 8px; }
  .dim { color: var(--color-text-dim); }
  .primary { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
  .primary:disabled { opacity: .5; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--color-border); }
  .report { border: 1px solid var(--color-border); padding: 6px; border-radius: var(--radius); }
  .err-title { color: var(--color-danger-text); margin: 6px 0; }
  .problems { margin-bottom: 8px; }
  .sets { display: flex; flex-direction: column; gap: 4px; }
</style>
