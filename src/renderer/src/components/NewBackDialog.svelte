<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * New card back (PRD §7.8): a card back for the active set, from one of a few starting designs, in the set's card size. It becomes the
   * set's card back at once; it is a template like any other, edited in the Template Editor.
   */
  import { createEventDispatcher } from 'svelte'
  import Modal from './Modal.svelte'
  import { BACK_DESIGNS, backSvg } from '../../../shared/backDesigns.js'

  export let set                       // the set the back is for: { name, card_size, card_mm_w, card_mm_h }
  export let size                      // { mmW, mmH } of that set
  const dispatch = createEventDispatcher()

  let name = tr('newBack.defaultName', { set: set.name })
  let design = 'classic'
  let primary = '#1b1b3a'
  let accent = '#e8c15a'

  const picture = d => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(backSvg(size, { design: d, primary, accent }).replace(/<g id="guides"[\s\S]*?<\/g>/, ''))}`
  const label = d => tr(`newBack.designs.${d}`)
  const create = open => { if (name.trim()) dispatch('create', { name: name.trim(), design, primary, accent, open }) }
</script>

<Modal title="{tr('newBack.title')}" width={520} on:close>
  <form on:submit|preventDefault={() => create(true)}>
    <label class="stack">{tr('newBack.name')}
      <input class="field" bind:value={name} />
    </label>
    <fieldset class="designs">
      <legend>{tr('newBack.design')}</legend>
      {#each BACK_DESIGNS as d (d)}
        <label class="design" class:chosen={design === d}>
          <input type="radio" name="back-design" value={d} bind:group={design} />
          <img src={picture(d)} alt="" />
          <span>{label(d)}</span>
        </label>
      {/each}
    </fieldset>
    <div class="colours">
      <label>{tr('newBack.colour')} <input type="color" bind:value={primary} /></label>
      <label>{tr('newBack.accent')} <input type="color" bind:value={accent} /></label>
    </div>
    <p class="note" role="note">{tr('newBack.hint', { set: set.name })}</p>
    <div class="actions">
      <button type="button" on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
      <span class="spacer" />
      <button type="button" on:click={() => create(false)}>{tr('newBack.create')}</button>
      <button type="submit" class="primary">{tr('newBack.createAndEdit')}</button>
    </div>
  </form>
</Modal>

<style>
  form { display: flex; flex-direction: column; gap: 12px; }
  .stack { display: flex; flex-direction: column; gap: 2px; color: var(--color-text-dim); font-size: 11px; }
  .designs { display: flex; gap: 10px; border: 0; padding: 0; margin: 0; }
  .designs legend { font-size: 11px; color: var(--color-text-dim); margin-bottom: 4px; padding: 0; }
  .design { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; border: 1px solid var(--color-control-border); border-radius: var(--radius-md, 8px); cursor: pointer; font-size: 12px; }
  .design.chosen { border-color: var(--color-accent-text); box-shadow: 0 0 0 2px var(--color-accent-text); }
  .design input { position: absolute; opacity: 0; pointer-events: none; }
  .design img { width: 100%; max-height: 150px; object-fit: contain; border-radius: var(--radius-sm); }
  .colours { display: flex; gap: 18px; font-size: 12px; align-items: center; }
  .colours label { display: flex; align-items: center; gap: 6px; }
  .note { font-size: 11px; color: var(--color-text); border-left: 3px solid var(--color-accent-text); padding-left: 8px; margin: 0; }
  .actions { display: flex; align-items: center; gap: 8px; }
  .spacer { flex: 1; }
</style>
