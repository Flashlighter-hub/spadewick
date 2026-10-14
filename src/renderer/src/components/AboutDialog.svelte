<script>
  import { tr } from '../../../shared/i18n.js'
  import { createEventDispatcher } from 'svelte'
  import Modal from './Modal.svelte'
  const dispatch = createEventDispatcher()
</script>

<Modal title="{tr('aboutDialog.aboutSpadewick')}" width={380} on:close>
  <p><strong>{tr('common.spadewick')}</strong> {tr('aboutDialog.localFirstGameAgnosticCard')}</p>
  <p class="dim">{tr('aboutDialog.offlineAndPortableAllProjects')}</p>
  <svelte:fragment slot="footer"><button on:click={() => dispatch('close')}>{tr('common.close')}</button></svelte:fragment>
</Modal>

<style>.dim { color: var(--color-text-dim); }</style>
