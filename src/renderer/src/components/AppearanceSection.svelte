<script>
  /**
   * The Appearance section of the properties panel (A80): rotation, fill (a colour or a gradient), stroke with its options, opacity,
   * blend mode, drop shadow and blur. It only shows and asks: the canvas editor writes the SVG, so it stays the one place that edits it.
   */
  import { createEventDispatcher } from 'svelte'
  import { tr } from '../../../shared/i18n.js'

  export let p                         // the properties of the selected element
  export let swatches = []             // colours this template already uses: tap one to use it again
  export let hasStroke = true          // text and images have no stroke of their own

  const dispatch = createEventDispatcher()
  const HEX = /^#[0-9a-f]{6}$/i
  const asHex = v => (HEX.test(v) ? v : '#808080')

  $: mode = p.gradient ? p.gradient.type : 'solid'
  $: stops = p.gradient?.stops ?? []
  $: fx = p.effects ?? { shadow: null, blur: 0, foreign: false }
  $: preview = stops.length
    ? `linear-gradient(${p.gradient.type === 'linear' ? (p.gradient.angle + 90) % 360 : 90}deg, ${[...stops].sort((a, b) => a.offset - b.offset).map(s => `${s.color} ${s.offset}%`).join(', ')})`
    : ''

  const solid = color => dispatch('fill', { mode: 'solid', color })
  const gradient = g => dispatch('fill', { mode: 'gradient', gradient: g })

  function setMode(next) {
    if (next === mode) return
    if (next === 'solid') { solid(HEX.test(p.fill) ? p.fill : (stops[0]?.color ?? '#808080')); return }
    const base = p.gradient ?? { angle: 90, stops: [{ offset: 0, color: asHex(p.fill), opacity: 1 }, { offset: 100, color: '#ffffff', opacity: 1 }] }
    gradient({ ...base, type: next })
  }

  const withStop = (i, patch) => gradient({ ...p.gradient, stops: stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const addStop = () => {
    const sorted = [...stops].sort((a, b) => a.offset - b.offset)
    const gap = sorted.reduce((best, s, i) => (i && s.offset - sorted[i - 1].offset > best.size ? { at: (s.offset + sorted[i - 1].offset) / 2, size: s.offset - sorted[i - 1].offset, color: s.color } : best), { at: 50, size: -1, color: sorted[0]?.color ?? '#808080' })
    gradient({ ...p.gradient, stops: [...stops, { offset: Math.round(gap.at), color: gap.color, opacity: 1 }] })
  }
  const dropStop = i => { if (stops.length > 2) gradient({ ...p.gradient, stops: stops.filter((_, j) => j !== i) }) }

  // Stroke: the dash pattern follows the line width
  const widthOf = () => Math.max(1, Number(p.strokeWidth) || 1)
  function setDash(kind) {
    const w = widthOf()
    if (kind === 'solid') dispatch('attrs', { 'stroke-dasharray': '' })
    else if (kind === 'dashed') dispatch('attrs', { 'stroke-dasharray': `${w * 3} ${w * 2}` })
    else dispatch('attrs', { 'stroke-dasharray': `0 ${w * 2}`, 'stroke-linecap': 'round' })
  }
  function setWidth(v) {
    const w = Math.max(0, Number(v) || 0)
    const map = { 'stroke-width': w ? String(w) : '' }
    if (p.dash === 'dashed' && w) map['stroke-dasharray'] = `${w * 3} ${w * 2}`
    if (p.dash === 'dotted' && w) map['stroke-dasharray'] = `0 ${w * 2}`
    dispatch('attrs', map)
  }

  // Effects
  const effects = patch => dispatch('effects', { shadow: fx.shadow, blur: fx.blur, ...patch })
  const SHADOW = { dx: 4, dy: 4, blur: 4, color: '#000000', opacity: 0.4 }
  const withShadow = patch => effects({ shadow: { ...(fx.shadow ?? SHADOW), ...patch } })

  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion']
</script>

<label>{tr('canvasEditor.rotation')} <input type="number" step="1" value={p.rotation} on:change={e => dispatch('rotation', e.currentTarget.value)} /></label>

<fieldset class="paint">
  <legend>{tr('canvasEditor.fill')}</legend>
  <div class="seg" role="group" aria-label={tr('appearance.fillType')}>
    {#each [['solid', 'fillSolid'], ['linear', 'fillLinear'], ['radial', 'fillRadial']] as [m, key]}
      <button type="button" class:on={mode === m} aria-pressed={mode === m} on:click={() => setMode(m)}>{tr(`appearance.${key}`)}</button>
    {/each}
  </div>
  {#if mode === 'solid'}
    <span class="color">
      <input type="color" aria-label={tr('appearance.fillColour')} value={asHex(p.fill)} on:change={e => solid(e.currentTarget.value)} />
      <input aria-label={tr('appearance.fillValue')} value={p.fill} on:change={e => solid(e.currentTarget.value.trim())} />
    </span>
  {:else}
    <div class="bar" style="background: {preview}" role="img" aria-label={tr('appearance.gradientPreview')}></div>
    {#each stops as s, i}
      <div class="stop">
        <input type="color" aria-label={tr('appearance.stopColour', { n: i + 1 })} value={asHex(s.color)} on:change={e => withStop(i, { color: e.currentTarget.value })} />
        <input type="number" min="0" max="100" step="1" aria-label={tr('appearance.stopPosition', { n: i + 1 })} value={s.offset} on:change={e => withStop(i, { offset: Math.min(100, Math.max(0, Number(e.currentTarget.value) || 0)) })} />
        <span class="unit" aria-hidden="true">%</span>
        <button type="button" class="x" aria-label={tr('appearance.removeStop', { n: i + 1 })} disabled={stops.length <= 2} on:click={() => dropStop(i)}>×</button>
      </div>
    {/each}
    <div class="row">
      <button type="button" on:click={addStop}>{tr('appearance.addStop')}</button>
      {#if mode === 'linear'}<label class="inline">{tr('appearance.angle')} <input type="number" step="5" value={p.gradient.angle} on:change={e => gradient({ ...p.gradient, angle: Number(e.currentTarget.value) || 0 })} /></label>{/if}
    </div>
    {#if p.gradient?.complex}<p class="note">{tr('appearance.complexGradient')}</p>{/if}
  {/if}
  {#if swatches.length}
    <div class="swatches" role="group" aria-label={tr('appearance.swatches')}>
      {#each swatches as c}<button type="button" class="sw" style="background: {c}" title={c} aria-label={tr('appearance.useFill', { colour: c })} on:click={() => solid(c)}></button>{/each}
    </div>
  {/if}
</fieldset>

{#if hasStroke}
  <fieldset class="paint">
    <legend>{tr('canvasEditor.stroke')}</legend>
    <span class="color">
      <input type="color" aria-label={tr('appearance.strokeColour')} value={asHex(p.stroke)} on:change={e => dispatch('attrs', { stroke: e.currentTarget.value })} />
      <input aria-label={tr('appearance.strokeValue')} value={p.stroke} on:change={e => dispatch('attrs', { stroke: e.currentTarget.value.trim() })} />
    </span>
    <div class="grid2">
      <label>{tr('appearance.strokeWidth')} <input type="number" min="0" step="0.5" value={p.strokeWidth} on:change={e => setWidth(e.currentTarget.value)} /></label>
      <label>{tr('appearance.dash')}
        <select value={p.dash} on:change={e => setDash(e.currentTarget.value)}>
          <option value="solid">{tr('appearance.dashSolid')}</option><option value="dashed">{tr('appearance.dashDashed')}</option><option value="dotted">{tr('appearance.dashDotted')}</option>
        </select>
      </label>
      <label>{tr('appearance.cap')}
        <select value={p.cap || 'butt'} on:change={e => dispatch('attrs', { 'stroke-linecap': e.currentTarget.value === 'butt' ? '' : e.currentTarget.value })}>
          <option value="butt">{tr('appearance.capButt')}</option><option value="round">{tr('appearance.capRound')}</option><option value="square">{tr('appearance.capSquare')}</option>
        </select>
      </label>
      <label>{tr('appearance.join')}
        <select value={p.join || 'miter'} on:change={e => dispatch('attrs', { 'stroke-linejoin': e.currentTarget.value === 'miter' ? '' : e.currentTarget.value })}>
          <option value="miter">{tr('appearance.joinMiter')}</option><option value="round">{tr('appearance.joinRound')}</option><option value="bevel">{tr('appearance.joinBevel')}</option>
        </select>
      </label>
    </div>
    {#if swatches.length}
      <div class="swatches" role="group" aria-label={tr('appearance.swatches')}>
        {#each swatches as c}<button type="button" class="sw" style="background: {c}" title={c} aria-label={tr('appearance.useStroke', { colour: c })} on:click={() => dispatch('attrs', { stroke: c })}></button>{/each}
      </div>
    {/if}
  </fieldset>
{/if}

<label>{tr('canvasEditor.opacity')} <input type="range" min="0" max="1" step="0.05" value={p.opacity} on:change={e => dispatch('attrs', { opacity: e.currentTarget.value === '1' ? '' : e.currentTarget.value })} /></label>

<label>{tr('appearance.blend')}
  <select value={p.blend || 'normal'} on:change={e => dispatch('blend', e.currentTarget.value)}>
    {#each BLENDS as b}<option value={b}>{tr(`appearance.blend_${b.replace('-', '_')}`)}</option>{/each}
  </select>
</label>

<fieldset class="paint">
  <legend>{tr('appearance.effects')}</legend>
  {#if fx.foreign}<p class="note">{tr('appearance.foreignFilter')}</p>{/if}
  <label class="inline"><input type="checkbox" checked={!!fx.shadow} on:change={e => effects({ shadow: e.currentTarget.checked ? { ...SHADOW } : null })} /> {tr('appearance.shadow')}</label>
  {#if fx.shadow}
    <div class="grid2">
      <label>{tr('appearance.shadowX')} <input type="number" step="1" value={fx.shadow.dx} on:change={e => withShadow({ dx: Number(e.currentTarget.value) || 0 })} /></label>
      <label>{tr('appearance.shadowY')} <input type="number" step="1" value={fx.shadow.dy} on:change={e => withShadow({ dy: Number(e.currentTarget.value) || 0 })} /></label>
      <label>{tr('appearance.shadowBlur')} <input type="number" min="0" step="1" value={fx.shadow.blur} on:change={e => withShadow({ blur: Math.max(0, Number(e.currentTarget.value) || 0) })} /></label>
      <label>{tr('appearance.shadowOpacity')} <input type="number" min="0" max="100" step="5" value={Math.round(fx.shadow.opacity * 100)} on:change={e => withShadow({ opacity: Math.min(1, Math.max(0, (Number(e.currentTarget.value) || 0) / 100)) })} /></label>
    </div>
    <label>{tr('appearance.shadowColour')}
      <span class="color">
        <input type="color" aria-label={tr('appearance.shadowColour')} value={asHex(fx.shadow.color)} on:change={e => withShadow({ color: e.currentTarget.value })} />
        <input aria-label={tr('appearance.shadowColourValue')} value={fx.shadow.color} on:change={e => withShadow({ color: e.currentTarget.value.trim() })} />
      </span>
    </label>
  {/if}
  <label>{tr('appearance.blur')} <input type="number" min="0" step="1" value={fx.blur} on:change={e => effects({ blur: Math.max(0, Number(e.currentTarget.value) || 0) })} /></label>
</fieldset>

<style>
  label { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-dim); }
  label.inline { flex-direction: row; align-items: center; gap: 6px; }
  input, select { width: 100%; min-width: 0; }
  input[type='checkbox'] { width: auto; }
  .paint { border: 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 0; }
  legend { padding: 0; font-size: 11px; color: var(--color-text-dim); margin-bottom: 2px; }
  .seg { display: flex; padding: 2px; gap: 2px; background: var(--color-surface-2); border-radius: var(--radius); }
  .seg button { flex: 1; padding: 2px 4px; font-size: 11px; border-color: transparent; background: transparent; box-shadow: none; border-radius: var(--radius-sm); }
  .seg button.on { background: var(--gradient-accent); color: var(--color-on-accent); }
  .color { display: flex; gap: 4px; }
  .color input[type='color'] { width: 30px; padding: 0; flex: none; }
  .bar { height: 18px; border-radius: var(--radius-sm); border: 1px solid var(--color-control-border); }
  .stop { display: flex; align-items: center; gap: 4px; }
  .stop input[type='color'] { width: 30px; padding: 0; flex: none; }
  .stop input[type='number'] { width: 64px; flex: none; }
  .unit { color: var(--color-text-dim); }
  .x { margin-left: auto; padding: 0 8px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .row label.inline { margin-left: auto; }
  .row label.inline input { width: 64px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .swatches { display: flex; flex-wrap: wrap; gap: 4px; }
  .sw { width: 18px; height: 18px; padding: 0; border-radius: var(--radius-sm); border: 1px solid var(--color-control-border); }
  .sw:hover { transform: scale(1.12); }
  .note { color: var(--color-text-dim); font-style: italic; margin: 0; }
</style>
