<script>
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher, onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import CanvasEditor from './CanvasEditor.svelte'
  import { cards, activeSetId, loadSet } from '../stores/project.js'
  import { toast } from '../stores/ui.js'
  import { askConfirm } from '../stores/prompt.js'

  /**
   * One card's own version of its template (UPDATES U29). The canvas editor opens on the template's source with this card's changes on it,
   * drawn with this card's data. Saving keeps only what differs from the template, as this card's changes; the template is never touched, and
   * the other cards that use it are drawn as before. Reset puts the card back to exactly the template.
   */
  export let cardId
  const dispatch = createEventDispatcher()

  let info = null          // { templateId, templateName, hasInstance, changes, base, source }
  let svgSource = ''
  let loadedSource = ''
  let busy = false
  let problem = ''

  $: card = $cards.find(c => c.id === cardId) ?? null
  $: dirty = !!info && svgSource !== loadedSource

  onMount(async () => {
    try {
      info = await window.spadewick.instances.get({ cardId })
      svgSource = loadedSource = info.source
    } catch (err) { problem = err.message }
  })

  async function leave() {
    if (dirty && !await askConfirm(tr('instance.confirmDiscard'))) return
    dispatch('close')
  }

  async function save() {
    busy = true
    try {
      const res = await window.spadewick.instances.save({ cardId, source: svgSource })
      await loadSet($activeSetId)
      window.dispatchEvent(new Event('spadewick:rerender'))
      toast(res.hasInstance ? tr('instance.savedChanges', { n: res.changes }) : tr('instance.savedSame'), 'info', 3500)
      dispatch('close')
    } catch (err) { toast(tr('instance.couldNotSave', { reason: err.message }), 'error', 6000) } finally { busy = false }
  }

  async function reset() {
    if (!await askConfirm(tr('instance.confirmReset', { name: card?.display_name || card?.card_code || '' }))) return
    busy = true
    try {
      await window.spadewick.instances.reset({ cardId })
      await loadSet($activeSetId)
      window.dispatchEvent(new Event('spadewick:rerender'))
      toast(tr('instance.resetDone'), 'info', 3000)
      dispatch('close')
    } catch (err) { toast(err.message, 'error', 5000) } finally { busy = false }
  }
</script>

<Modal title={tr('instance.title', { name: card?.display_name || card?.card_code || tr('cardDataEditor.unnamedCard') })} width={1280} on:close={leave}>
  {#if problem}
    <p class="error" role="alert">{problem}</p>
  {:else if info}
    <p class="intro">{tr('instance.intro', { template: info.templateName })}</p>
    <div class="editor">
      <CanvasEditor bind:svgSource templateId={info.templateId} {cardId} lockCard bleedMm={0} />
    </div>
  {:else}
    <p class="intro">{tr('instance.loading')}</p>
  {/if}
  <svelte:fragment slot="footer">
    <button on:click={reset} disabled={busy || !info?.hasInstance}>{tr('instance.reset')}</button>
    <span class="spacer" />
    <span class="state" role="status">{dirty ? tr('instance.unsaved') : info?.hasInstance ? tr('instance.hasChanges', { n: info.changes }) : ''}</span>
    <button on:click={leave}>{tr('common.cancel')}</button>
    <button class="primary" on:click={save} disabled={busy || !info || !dirty}>{tr('common.save')}</button>
  </svelte:fragment>
</Modal>

<style>
  .intro { margin: 0 0 8px; font-size: 12px; color: var(--color-text-dim); }
  .editor { display: flex; height: min(70vh, 780px); min-height: 420px; border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; }
  .error { color: var(--color-danger-text); }
  .spacer { flex: 1; }
  .state { font-size: 12px; color: var(--color-text-dim); }
  .primary { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
  .primary:disabled { opacity: .5; }
</style>
