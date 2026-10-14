<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * The colours of a die, a counter or a round token (UPDATES U3): the body, and the number or pips on it. The number's colour is chosen
   * to read on the body unless one is picked; both are kept with the table.
   */
  import { createEventDispatcher } from 'svelte'
  import Modal from './Modal.svelte'
  import { tokenColors, cleanColor } from '../../../shared/table.js'

  export let token
  const dispatch = createEventDispatcher()

  let color = cleanColor(token.color) ?? ''
  let ink = cleanColor(token.ink) ?? ''
  $: shown = tokenColors({ ...token, color, ink })
  const apply = () => dispatch('apply', { color, ink })
</script>

<Modal title="{tr('table.colorsTitle')}" width={380} on:close>
  <div class="sample" style="background:{shown.body};color:{shown.ink};border-color:{shown.ink}" aria-hidden="true">{token.kind === 'die' ? token.value : token.kind === 'counter' ? token.value : '●'}</div>
  <div class="row">
    <label>{tr('table.colorBody')} <input type="color" value={shown.body} on:input={e => (color = e.target.value)} /></label>
    <button on:click={() => (color = '')} disabled={!color}>{tr('table.colorUsual')}</button>
  </div>
  <div class="row">
    <label>{tr('table.colorInk')} <input type="color" value={shown.ink} on:input={e => (ink = e.target.value)} /></label>
    <button on:click={() => (ink = '')} disabled={!ink}>{tr('table.colorAuto')}</button>
  </div>
  <svelte:fragment slot="footer">
    <button on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
    <button class="primary" on:click={apply}>{tr('common.ok')}</button>
  </svelte:fragment>
</Modal>

<style>
  .sample { width: 72px; height: 72px; margin: 0 auto 12px; border-radius: 14px; border: 3px solid; display: flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 800; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 6px 0; }
  .row label { display: flex; align-items: center; gap: 8px; }
</style>
