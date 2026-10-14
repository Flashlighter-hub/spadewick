<script>
  import { tr } from '../../../shared/i18n.js'

  export let before = null     // base64 PNG of the earlier version, or null
  export let after = null      // base64 PNG of the later version, or null
  export let mode = 'side'     // 'side' | 'overlay' | 'slider'
  export let afterLabel = tr('compare.after')

  let amount = 50              // slider: where the dividing line is; overlay: how much of the new version shows (per cent)
  const src = b64 => `data:image/png;base64,${b64}`
</script>

{#if mode === 'side' || !before || !after}
  <div class="pics">
    <figure><figcaption>{tr('compare.before')}</figcaption>
      {#if before}<img alt="" src={src(before)} />{:else}<div class="blank">{tr('compare.noPicture')}</div>{/if}</figure>
    <figure><figcaption>{afterLabel}</figcaption>
      {#if after}<img alt="" src={src(after)} />{:else}<div class="blank">{tr('compare.noPicture')}</div>{/if}</figure>
  </div>
{:else if mode === 'overlay'}
  <div class="stack">
    <div class="frame">
      <img alt="" src={src(before)} />
      <img class="top" alt="" style="opacity: {amount / 100}" src={src(after)} />
    </div>
    <label class="range">{tr('compare.before')} <input type="range" min="0" max="100" bind:value={amount} aria-label={tr('compare.overlayLabel')} /> {afterLabel}</label>
  </div>
{:else}
  <div class="stack">
    <div class="frame">
      <img alt="" src={src(after)} />
      <img class="top" alt="" style="clip-path: inset(0 {100 - amount}% 0 0)" src={src(before)} />
      <span class="line" style="left: {amount}%" aria-hidden="true"></span>
    </div>
    <label class="range">{tr('compare.before')} <input type="range" min="0" max="100" bind:value={amount} aria-label={tr('compare.sliderLabel')} /> {afterLabel}</label>
  </div>
{/if}

<style>
  .pics { display: flex; gap: 16px; flex-wrap: wrap; }
  figure { margin: 0; }
  figcaption { font-size: 11px; color: var(--color-text-dim); }
  img { display: block; max-width: 240px; border: 1px solid var(--color-border); }
  .blank { width: 160px; height: 100px; display: grid; place-items: center; border: 1px dashed var(--color-border); color: var(--color-text-dim); font-size: 11px; text-align: center; }
  .stack { display: flex; flex-direction: column; gap: 4px; }
  .frame { position: relative; display: inline-block; line-height: 0; }
  .frame .top { position: absolute; left: 0; top: 0; border-color: transparent; }
  .line { position: absolute; top: 0; bottom: 0; width: 2px; background: #0e7ded; }
  .range { display: flex; gap: 6px; align-items: center; font-size: 11px; color: var(--color-text-dim); }
  .range input { width: 160px; }
</style>
