<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * A question that is answered yes or no, in the application's own dialog. The browser's own confirm() is not used anywhere: in Electron
   * it leaves the window without keyboard focus until the person switches away and back, which made text boxes that came next impossible
   * to type in (UPDATES U1).
   */
  import Modal from './Modal.svelte'
  import { confirmRequest } from '../stores/prompt.js'

  function finish(answer) {
    const req = $confirmRequest
    confirmRequest.set(null)
    req?.resolve(answer)
  }
</script>

{#if $confirmRequest}
  <Modal title={tr('common.confirm')} width={440} on:close={() => finish(false)}>
    <form data-confirm-dialog on:submit|preventDefault={() => finish(true)}>
      <p class="message">{$confirmRequest.message}</p>
      <div class="actions">
        <button type="button" data-confirm-no on:click={() => finish(false)}>{tr('common.cancel')}</button>
        <button type="submit" class="primary" data-confirm-yes>{tr('common.ok')}</button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  form { display: flex; flex-direction: column; gap: 14px; }
  .message { margin: 0; white-space: pre-wrap; line-height: 1.45; overflow-wrap: anywhere; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .primary { background: var(--color-accent); color: var(--color-on-accent); border-color: var(--color-accent); }
</style>
