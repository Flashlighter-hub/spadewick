<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * Card preview pane — PRD §6.3
   * Shows a rendered PNG of the currently selected card.
   * Re-renders within 200ms of any field change (debounced).
   */

  import { onMount, onDestroy } from 'svelte'
  import Modal from './Modal.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import { layout, setLayout, LIMITS } from '../stores/layout.js'
  import { cards, activeSet } from '../stores/project.js'
  import { instanceEdit } from '../stores/ui.js'

  export let cardId = null      // card to render

  // Rendered once at a size that stays sharp across the whole range the pane can be dragged to
  const RENDER_WIDTH = 640

  let imgSrc = null
  let loading = false
  let error = null
  let debounceTimer = null

  // The back of the card (PRD §7.8): its own back, else the set's card back. The preview can be turned over when there is one.
  let side = 'front'
  $: card = $cards.find(c => c.id === cardId) ?? null
  $: hasBack = !!(card?.back_template_id || $activeSet?.default_back_template_id)
  $: if (!hasBack && side === 'back') { side = 'front'; scheduleRender() }
  function turn(next) { if (next === side) return; side = next; scheduleRender() }
  // the card's back may change while it is shown (a column edit, the set's slot): look again
  $: backKey = `${card?.back_template_id ?? ''}|${$activeSet?.default_back_template_id ?? ''}`
  $: if (side === 'back' && backKey) scheduleRender()

  // Re-render whenever cardId changes
  $: if (cardId) scheduleRender()
  $: if (!cardId) { imgSrc = null; error = null }

  export function invalidate() {
    scheduleRender()
  }

  function scheduleRender() {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(doRender, 150)
  }

  async function doRender() {
    if (!cardId) return
    loading = true
    error = null
    try {
      const b64 = await window.spadewick.templates.render({
        cardId,
        width: RENDER_WIDTH,
        side
      })
      imgSrc = `data:image/png;base64,${b64}`
    } catch (err) {
      error = err.message
      imgSrc = null
    } finally {
      loading = false
    }
  }

  // Full-size view: the card at 1:1 export pixels, in a scrollable in-app dialog (the app is single-window, PRD §15)
  let fullSrc = null
  let fullBusy = false
  async function openFullSize() {
    if (!cardId) return
    fullBusy = true
    try {
      fullSrc = `data:image/png;base64,${await window.spadewick.templates.render({ cardId, side })}`
    } catch (err) {
      error = err.message
    } finally {
      fullBusy = false
    }
  }

  // Font and template changes elsewhere in the app update the preview straight away
  onMount(() => window.addEventListener('spadewick:rerender', scheduleRender))
  onDestroy(() => window.removeEventListener('spadewick:rerender', scheduleRender))

  onDestroy(() => clearTimeout(debounceTimer))
</script>

<ResizeHandle axis="x" grow={-1} min={LIMITS.preview.min} max={LIMITS.preview.max} reset={LIMITS.preview.reset}
  value={$layout.preview} label="{tr('resize.previewPane')}" on:change={e => setLayout('preview', e.detail)} />

<div class="preview-pane" style="width:{$layout.preview}px">
  <div class="preview-header">
    <span class="label">{tr('common.preview')}</span>
    <div class="preview-actions">
      <div class="sides" role="group" aria-label="{tr('cardPreview.side')}">
        <button class="side-btn" class:on={side === 'front'} aria-pressed={side === 'front'} on:click={() => turn('front')}>{tr('cardPreview.front')}</button>
        <button class="side-btn" class:on={side === 'back'} aria-pressed={side === 'back'} disabled={!hasBack} title={hasBack ? '' : tr('cardPreview.noBack')} on:click={() => turn('back')}>{tr('cardPreview.back')}</button>
      </div>
      <button class="icon-btn" title="{tr('cardPreview.fullSize')}" aria-label="{tr('cardPreview.showCardAtFullSize')}" on:click={openFullSize} disabled={!imgSrc || fullBusy}>⤢</button>
    </div>
  </div>

  <div class="preview-area">
    {#if !cardId}
      <span class="hint">{tr('cardPreview.selectACard')}</span>
    {:else if loading}
      <span class="hint loading">{tr('cardPreview.rendering')}</span>
    {:else if error}
      <div class="error-state" class:gentle={error === tr('errors.noTemplate') || error === tr('errors.noBack')}>
        <span class="error-icon" aria-hidden="true">{error === tr('errors.noTemplate') || error === tr('errors.noBack') ? 'ⓘ' : '⚠'}</span>
        <span class="error-msg">{error}</span>
      </div>
    {:else if imgSrc}
      <img src={imgSrc} alt="{tr('cardPreview.cardPreview')}" class="preview-img" />
    {:else}
      <span class="hint">{tr('cardPreview.noTemplateAssigned')}</span>
    {/if}
  </div>
  {#if cardId && imgSrc && !error}
    <!-- this card's own version of its template (UPDATES U29) -->
    <div class="own">
      {#if card?.instance_json}<span class="own-note" role="status">{tr('instance.hasOwn')}</span>{/if}
      <button on:click={() => instanceEdit.set(cardId)} title="{tr('instance.editHint')}">{card?.instance_json ? tr('instance.editAgain') : tr('instance.edit')}</button>
    </div>
  {/if}
</div>

{#if fullSrc}
  <Modal title="{tr('cardPreview.cardAtFullSize')}" width={760} on:close={() => fullSrc = null}>
    <!-- scrollable region must be keyboard focusable (axe: scrollable-region-focusable) -->
    <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
    <div class="full-scroll" tabindex="0" role="region" aria-label="{tr('cardPreview.fullSizeCard')}"><img src={fullSrc} alt="{tr('cardPreview.cardAtFullSize')}" class="full-img" /></div>
  </Modal>
{/if}

<style>
  .full-scroll { max-height: 70vh; overflow: auto; background: var(--color-surface-2); }
  .full-img { display: block; max-width: none; }
  .preview-pane {
    background: var(--color-surface);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-dim);
  }

  .own { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-top: 1px solid var(--color-border); flex-wrap: wrap; }
  .own-note { font-size: 11px; color: var(--color-accent-text); }
  .preview-actions { display: flex; gap: 4px; align-items: center; }
  .sides { display: inline-flex; border: 1px solid var(--color-control-border); border-radius: var(--radius-sm); overflow: hidden; }
  .side-btn { background: none; border: 0; padding: 1px 8px; font-size: 11px; color: var(--color-text-dim); cursor: pointer; border-radius: 0; }
  .side-btn.on { background: var(--color-accent-text); color: var(--color-bg, #fff); }
  .side-btn:disabled { opacity: 0.4; cursor: default; }

  .icon-btn {
    background: none;
    border: none;
    padding: 2px 4px;
    font-size: 14px;
    color: var(--color-text-dim);
    cursor: pointer;
    border-radius: 2px;
  }

  .icon-btn:hover:not(:disabled) { color: var(--color-text); background: var(--color-surface-2); }
  .icon-btn:disabled { opacity: 0.3; cursor: default; }

  .preview-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    overflow: hidden;
  }

  .preview-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--radius-sm);
    box-shadow: 0 2px 12px rgba(0,0,0,0.5);
  }

  .hint {
    color: var(--color-text-dim);
    font-style: italic;
    font-size: 12px;
    text-align: center;
  }

  .hint.loading {
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px;
    text-align: center;
  }

  .error-icon { font-size: 22px; color: var(--color-danger-text); }
  .gentle .error-icon { color: var(--color-accent-text); }
  .gentle .error-msg { font-size: 12px; max-width: 220px; line-height: 1.45; }
  .error-msg  { font-size: 11px; color: var(--color-text-dim); word-break: break-word; }
</style>
