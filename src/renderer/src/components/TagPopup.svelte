<script>
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher, onMount } from 'svelte'
  import { splitTags, joinTags } from '../../../shared/fieldTypes.js'

  /** The tags of one cell (UPDATES U23): the field's allowed tags as checkboxes. Enter or OK keeps the choice, Escape leaves it as it was. */
  export let value = ''
  export let options = []
  export let rect = null   // where the cell is: the list is placed under it
  const dispatch = createEventDispatcher()

  let chosen = new Set(splitTags(value).map(t => t.toLowerCase()))
  // tags the cell holds that the list does not (the list was changed later): shown, so they can be taken away
  const extra = splitTags(value).filter(t => !options.some(o => o.toLowerCase() === t.toLowerCase()))
  const all = [...options, ...extra]
  let popup
  onMount(() => (popup?.querySelector("input") ?? popup?.querySelector("button"))?.focus())

  const toggle = tag => {
    const k = tag.toLowerCase()
    chosen.has(k) ? chosen.delete(k) : chosen.add(k)
    chosen = chosen
  }
  const done = () => dispatch('pick', joinTags(all.filter(t => chosen.has(t.toLowerCase()))))
</script>

<div class="shield" role="presentation" on:click={() => dispatch('close')} />
<!-- keydown handles Enter and Escape; focus is moved into the popup on mount -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="popup" bind:this={popup} style={rect ? `position:fixed;left:${rect.left}px;top:${rect.top}px` : ''} role="dialog" aria-label="{tr('tagPopup.title')}"
  on:keydown|stopPropagation={e => { if (e.key === 'Escape') dispatch('close'); else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); done() } }}>
  {#if all.length}
    <div class="list">
      {#each all as tag (tag)}
        <label><input type="checkbox" checked={chosen.has(tag.toLowerCase())} on:change={() => toggle(tag)} /> {tag}</label>
      {/each}
    </div>
  {:else}
    <p class="none">{tr('tagPopup.noList')}</p>
  {/if}
  <div class="actions">
    <button on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
    <button class="primary" on:click={done}>{tr('common.ok')}</button>
  </div>
</div>

<style>
  .shield { position: fixed; inset: 0; z-index: 40; }
  .popup { position: absolute; z-index: 41; top: 100%; left: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 8px; display: flex; flex-direction: column; gap: 6px; min-width: 170px; max-height: 280px; box-shadow: 0 6px 24px rgba(0,0,0,.4); }
  .list { display: flex; flex-direction: column; gap: 3px; overflow: auto; }
  label { display: flex; align-items: center; gap: 6px; white-space: nowrap; font-weight: 400; }
  .none { margin: 0; color: var(--color-text-dim); font-size: 11px; max-width: 220px; white-space: normal; }
  .actions { display: flex; justify-content: flex-end; gap: 6px; }
  .primary { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }
</style>
