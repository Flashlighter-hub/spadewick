<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * Project → Card IDs… (PRD §5.8): how new card IDs are made.
   * Existing IDs are never rewritten here; the settings only decide what the next IDs look like.
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import { toast } from '../stores/ui.js'
  import { parsePattern, formatCardId, DEFAULT_PATTERN, normalizeSetCode } from '../../../shared/cardIds.js'

  const dispatch = createEventDispatcher()
  const TOKENS = { set: '{set}', n: '{n}', author: '{author}' }   // shown literally in the help text

  let pattern = DEFAULT_PATTERN
  let scope = 'set'
  let start = 1
  let step = 1
  let author = ''
  let sets = []
  let loaded = false
  let busy = false

  onMount(async () => {
    const cfg = await window.spadewick.cardIds.get()
    ;({ pattern, scope, start, step, author, sets } = cfg)
    loaded = true
  })

  $: parsed = parsePattern(pattern)
  $: patternError = parsed.error ? tr(`cardIds.${parsed.error}`) : ''
  $: numbersOk = Number.isInteger(Number(start)) && Number(start) >= 0 && Number.isInteger(Number(step)) && Number(step) >= 1
  $: authorOk = normalizeSetCode(author).length === 2
  $: examples = patternError || !numbersOk ? [] : [0, 1, 2].map(i => formatCardId(pattern, { set: sets[0]?.code || 'SET', n: Number(start) + i * Number(step), author: normalizeSetCode(author) }))

  async function save() {
    busy = true
    try {
      await window.spadewick.cardIds.save({ pattern, scope, start: Number(start), step: Number(step), author })
      toast(tr('cardIdsDialog.saved'), 'info', 2500)
      dispatch('close')
    } catch (err) { toast(err.message, 'error', 5000) } finally { busy = false }
  }
</script>

<Modal title="{tr('cardIdsDialog.title')}" width={560} on:close>
  <p class="dim">{tr('cardIdsDialog.intro')}</p>

  {#if loaded}
    <label class="row">{tr('cardIdsDialog.pattern')}
      <input class="mono" bind:value={pattern} aria-describedby="pattern-help pattern-error" aria-invalid={patternError ? 'true' : undefined} />
    </label>
    <p id="pattern-help" class="dim">{tr('cardIdsDialog.patternHelp', TOKENS)}</p>
    <p id="pattern-error" class="error" role="alert">{patternError}</p>

    <label class="row">{tr('cardIdsDialog.counter')}
      <select bind:value={scope}>
        <option value="set">{tr('cardIdsDialog.perSet')}</option>
        <option value="project">{tr('cardIdsDialog.perProject')}</option>
      </select>
    </label>
    <div class="pair">
      <label class="row">{tr('cardIdsDialog.start')} <input type="number" min="0" step="1" bind:value={start} /></label>
      <label class="row">{tr('cardIdsDialog.step')} <input type="number" min="1" max="1000" step="1" bind:value={step} /></label>
    </div>
    <label class="row">{tr('cardIdsDialog.author')}
      <input class="mono" maxlength="2" bind:value={author} aria-describedby="author-help" aria-invalid={authorOk ? undefined : 'true'} />
    </label>
    <p id="author-help" class="dim">{tr('cardIdsDialog.authorHelp', TOKENS)}</p>

    <div role="status" aria-live="polite">
      {#if examples.length}
        <p>{tr('cardIdsDialog.examples')} <code class="mono">{examples.join(', ')}</code></p>
      {/if}
    </div>
    <p class="dim">{tr('cardIdsDialog.neverRewritten')}</p>
  {/if}

  <svelte:fragment slot="footer">
    <button on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
    <button class="primary" on:click={save} disabled={busy || !loaded || !!patternError || !numbersOk || !authorOk}>{tr('common.save')}</button>
  </svelte:fragment>
</Modal>

<style>
  .row { display: flex; flex-direction: column; gap: 3px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .mono { font-family: var(--font-mono); }
  .dim { color: var(--color-text-dim); }
  .error { color: var(--color-danger-text); min-height: 1em; }
  .primary { background: var(--color-accent); color: var(--color-on-accent); border-color: var(--color-accent); }
  .primary:disabled { opacity: .5; cursor: default; }
</style>
