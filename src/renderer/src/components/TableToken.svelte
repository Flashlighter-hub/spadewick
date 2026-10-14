<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * What a die, a group of dice, a counter or a round picture token looks like on the virtual table (PRD §7.9; UPDATES U2, U3, U4).
   * Pressing, dragging and the menu belong to the table (TableView), which passes in what to do; this file only draws the token and
   * says it with words for the screen reader.
   */
  import { tokenColors, droppedDie, TOKEN_SIZES } from '../../../shared/table.js'
  import { pictures, asset } from '../lib/tableImages.js'

  export let t
  export let down = () => {}          // (pointer event, what a press without a move does) the table starts a drag, or a click
  export let roll = () => {}
  export let step = () => {}          // (n) a counter, or the number of a picture token, goes up or down
  export let flip = () => {}

  $: colors = tokenColors(t)
  $: dropped = t.kind === 'die' ? droppedDie(t.values, t.drop) : -1
  $: pictureKey = t.kind === 'token' && (t.side === 1 ? t.asset2 : t.asset) ? asset(t.side === 1 ? t.asset2 : t.asset) : null
  $: picture = pictureKey ? $pictures[pictureKey] : null
  $: diameter = TOKEN_SIZES[t.size] ?? TOKEN_SIZES.medium
</script>

{#if t.kind === 'die'}
  <div class="dice" style="--body:{colors.body};--ink:{colors.ink}" class:group={t.count > 1}>
    <div class="faces">
      {#each t.values as v, i}
        <button class="die" class:small={t.count > 1} class:dropped={i === dropped}
          aria-label={i === 0 ? tr('table.rollDice', { count: t.count, sides: t.sides, total: t.value, values: t.values.join(', ') }) : tr('table.dieOfGroup', { k: i + 1, value: v })}
          tabindex={i === 0 ? 0 : -1}
          on:pointerdown={e => down(e, roll)}
          on:keydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); roll() } }}>
          <span class="value">{v}</span>{#if t.count === 1}<small>d{t.sides}</small>{/if}
        </button>
      {/each}
    </div>
    {#if t.count > 1}
      <div class="sum" aria-hidden="true"><span class="total">{t.value}</span><small>{t.count}d{t.sides}{t.drop === 'low' ? tr('table.dropLowShort') : t.drop === 'high' ? tr('table.dropHighShort') : ''}</small></div>
    {/if}
  </div>
{:else if t.kind === 'counter'}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="counter" style="--body:{colors.body};--ink:{colors.ink}" on:pointerdown={e => { if (!e.target.closest('button')) down(e) }}>
    <button aria-label="{tr('table.counterDown')}" on:click={() => step(-1)}>−</button>
    <span class="value" aria-hidden="true">{t.value}</span>
    <button aria-label="{tr('table.counterUp')}" on:click={() => step(1)}>+</button>
    {#if t.label}<small>{t.label}</small>{/if}
  </div>
{:else}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="picture" style="--body:{colors.body};--ink:{colors.ink};--d:{diameter}px"
    on:pointerdown={e => { if (!e.target.closest('button')) down(e) }} on:dblclick={flip}>
    <div class="disc" role="img" aria-label={t.label || tr('table.pictureToken')}>
      {#if picture && picture !== 'failed'}<img src={picture} alt="" draggable="false" />{/if}
    </div>
    {#if t.label}<small class="name">{t.label}</small>{/if}
    {#if t.showNumber}
      <div class="number">
        <button aria-label="{tr('table.counterDown')}" on:click={() => step(-1)}>−</button>
        <span class="value" aria-label="{tr('table.tokenNumber', { value: t.value })}">{t.value}</span>
        <button aria-label="{tr('table.counterUp')}" on:click={() => step(1)}>+</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .dice { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 250px; }
  .faces { display: flex; flex-wrap: wrap; gap: 4px; }
  .die { width: 58px; height: 58px; border-radius: 12px; background: var(--body); color: var(--ink); border: 2px solid var(--ink); display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; padding: 0; box-shadow: 0 3px 8px rgba(0,0,0,.45); }
  .die.small { width: 40px; height: 40px; border-radius: var(--radius); }
  .die .value { font-size: 24px; font-weight: 800; line-height: 1; }
  .die.small .value { font-size: 18px; }
  .die small { font-size: 10px; opacity: .75; }
  .die.dropped { opacity: .4; text-decoration: line-through; }
  .sum { display: flex; align-items: baseline; gap: 6px; background: #212529; color: #fff; border-radius: 999px; padding: 2px 12px; box-shadow: 0 3px 8px rgba(0,0,0,.45); }
  .sum .total { font-size: 22px; font-weight: 800; }
  .sum small { font-size: 11px; color: #ced4da; }

  .counter { display: flex; align-items: center; gap: 4px; background: var(--body); color: var(--ink); border-radius: 999px; padding: 4px 8px; cursor: grab; box-shadow: 0 3px 8px rgba(0,0,0,.45); }
  .counter .value { min-width: 32px; text-align: center; font-size: 20px; font-weight: 800; }
  .counter button { width: 28px; height: 28px; border-radius: 50%; padding: 0; }
  .counter small { font-size: 11px; opacity: .8; margin-left: 4px; }

  .picture { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: grab; }
  .disc { width: var(--d); height: var(--d); border-radius: 50%; background: var(--body); border: 3px solid var(--ink); box-sizing: border-box; overflow: hidden; box-shadow: 0 3px 8px rgba(0,0,0,.45); }
  .disc img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  .name { color: #fff; font-size: 12px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.8); max-width: 140px; text-align: center; }
  .number { display: flex; align-items: center; gap: 3px; background: var(--body); color: var(--ink); border-radius: 999px; padding: 1px 4px; box-shadow: 0 2px 6px rgba(0,0,0,.45); }
  .number button { width: 22px; height: 22px; border-radius: 50%; padding: 0; line-height: 1; }
  .number .value { min-width: 24px; text-align: center; font-weight: 800; }
</style>
