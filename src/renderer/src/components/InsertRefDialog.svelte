<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * A reference for a page of the Rules (PRD §7.11): a link to another page, or a card (as a link to it, or as its picture).
   */
  import { createEventDispatcher } from 'svelte'
  import Modal from './Modal.svelte'

  export let pages = []             // the pages of the rules: { id, title }
  export let cards = []             // the cards of the project: { id, name, code, set }
  export let hide = null            // a page that is not offered (the one being written)
  const dispatch = createEventDispatcher()

  let filter = ''
  $: needle = filter.trim().toLowerCase()
  $: shownPages = pages.filter(p => p.id !== hide && (!needle || p.title.toLowerCase().includes(needle)))
  $: shownCards = cards.filter(c => !needle || `${c.name} ${c.code}`.toLowerCase().includes(needle)).slice(0, 200)
</script>

<Modal title="{tr('rulesView.refTitle')}" width={640} on:close>
  <label class="find">{tr('rulesView.refFind')} <input class="field" bind:value={filter} /></label>
  <div class="cols">
    <section>
      <h3>{tr('rulesView.refPages')}</h3>
      <ul aria-label="{tr('rulesView.refPages')}">
        {#each shownPages as p (p.id)}
          <li><button on:click={() => dispatch('page', { title: p.title })}>{p.title}</button></li>
        {:else}<li class="none">{tr('rulesView.refNone')}</li>{/each}
      </ul>
    </section>
    <section>
      <h3>{tr('rulesView.refCards')}</h3>
      <ul aria-label="{tr('rulesView.refCards')}">
        {#each shownCards as c (c.id)}
          <li class="card">
            <span class="name">{c.name} <span class="dim">{c.set}</span></span>
            <button on:click={() => dispatch('card', { name: c.name || c.code, embed: false })} aria-label="{tr('rulesView.refLinkTo', { name: c.name })}">{tr('rulesView.refLink')}</button>
            <button on:click={() => dispatch('card', { name: c.name || c.code, embed: true })} aria-label="{tr('rulesView.refPictureOf', { name: c.name })}">{tr('rulesView.refPicture')}</button>
          </li>
        {:else}<li class="none">{tr('rulesView.refNone')}</li>{/each}
      </ul>
    </section>
  </div>
  <div class="foot"><span class="spacer" /><button on:click={() => dispatch('close')}>{tr('common.cancel')}</button></div>
</Modal>

<style>
  .find { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 8px; }
  .find input { flex: 1; }
  .cols { display: grid; grid-template-columns: 1fr 1.4fr; gap: 14px; }
  h3 { margin: 0 0 6px; font-size: 12px; color: var(--color-text-dim); text-transform: uppercase; letter-spacing: .05em; }
  ul { list-style: none; margin: 0; padding: 0; max-height: 46vh; overflow: auto; display: flex; flex-direction: column; gap: 3px; }
  li button { width: 100%; text-align: left; }
  li.card { display: flex; align-items: center; gap: 4px; }
  li.card .name { flex: 1; font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li.card button { width: auto; font-size: 11px; padding: 2px 8px; }
  .dim { color: var(--color-text-dim); font-size: 11px; }
  .none { color: var(--color-text-dim); font-style: italic; font-size: 12px; }
  .foot { display: flex; margin-top: 10px; }
  .spacer { flex: 1; }
</style>
