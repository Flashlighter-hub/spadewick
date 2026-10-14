<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * One card of the virtual table, face up (its front, as the application draws it) or face down (its back, or a plain one when it
   * has none). The picture arrives when it is drawn; until then, and for a card that cannot be drawn, the card's name stands in.
   */
  import { pictures, epoch, front, back, PICTURE_WIDTH } from '../lib/tableImages.js'

  export let info                      // { id, name, back, w, h, missing? } of the card; missing: the project no longer has it
  export let faceUp = false
  export let width = 140               // pixels it is shown at
  export let drawn = PICTURE_WIDTH     // pixels it is drawn at

  $: height = Math.round(width * info.h / info.w)
  // the picture is asked for again whenever pictures were forgotten ($epoch)
  $: key = ($epoch, faceUp ? front(info.id, drawn) : (info.back ? back(info.id, info.back, drawn) : null))
  $: src = key ? $pictures[key] : null
</script>

<div class="face" class:up={faceUp} style="width:{width}px;height:{height}px">
  {#if info.missing}
    <div class="stand-in gone"><span>{tr('table.cardRemoved', { name: info.name })}</span></div>
  {:else if src && src !== 'failed'}
    <img {src} alt="" draggable="false" />
  {:else if !faceUp && !info.back}
    <div class="plain-back" aria-hidden="true"></div>
  {:else}
    <div class="stand-in" aria-hidden="true"><span>{faceUp ? info.name : tr('table.cardBack')}</span></div>
  {/if}
</div>

<style>
  .face { position: relative; border-radius: var(--radius); overflow: hidden; background: var(--color-surface-2); user-select: none; }
  img { width: 100%; height: 100%; display: block; pointer-events: none; }
  .plain-back { width: 100%; height: 100%; background:
    repeating-linear-gradient(45deg, rgba(255,255,255,.10) 0 6px, transparent 6px 12px), linear-gradient(135deg, #1b1b3a, #3b2fb8); border: 3px solid #e8c15a; box-sizing: border-box; border-radius: var(--radius); }
  .stand-in.gone { border-style: dashed; color: var(--color-text); }
  .stand-in { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 8px; box-sizing: border-box;
    font-size: 12px; color: var(--color-text-dim); background: var(--color-surface-2); border: 1px solid var(--color-control-border); border-radius: var(--radius); }
</style>
