<script>
  import { tr } from '../../../shared/i18n.js'
  import Modal from './Modal.svelte'
  import { promptRequest } from '../stores/prompt.js'

  let value = ''
  let current = null
  $: if ($promptRequest && $promptRequest !== current) { current = $promptRequest; value = current.initial ?? '' }

  function finish(result) {
    const req = $promptRequest
    promptRequest.set(null); current = null
    req?.resolve(result)
  }
</script>

{#if $promptRequest}
  <Modal title={$promptRequest.message} width={420} on:close={() => finish(null)}>
    <form data-prompt-dialog on:submit|preventDefault={() => finish(value)}>
      <input class="field" bind:value aria-label={$promptRequest.message} />
      <div class="actions">
        <button type="button" on:click={() => finish(null)}>{tr('common.cancel')}</button>
        <button type="submit" class="primary">{tr('common.ok')}</button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  form { display: flex; flex-direction: column; gap: 10px; }
  .field { width: 100%; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .primary { background: var(--color-accent); color: var(--color-on-accent); border-color: var(--color-accent); }
</style>
