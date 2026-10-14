<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * Joining somebody else's table (PRD §22.0), guest's side: paste the invitation the host gave you, give the answer back, and the table
   * appears. No project is needed; the host sends the cards and their pictures. After a broken connection the same dialog gives the seat
   * back (it keeps the ticket of the game).
   */
  import { createEventDispatcher, onMount } from 'svelte'
  import Modal from './Modal.svelte'
  import { tableMode, shareInfo, joinTable } from '../stores/table.js'
  import { toast } from '../stores/ui.js'
  import { loadShareSettings, saveShareSettings, iceServersOf } from '../lib/shareSettings.js'

  const dispatch = createEventDispatcher()
  const saved = loadShareSettings()
  let name = saved.name || tr('tableShare.defaultGuest')
  let useStun = saved.useStun
  let stunUrl = saved.stunUrl
  let invitation = ''
  let answer = ''
  let error = ''
  let busy = false
  let ticket = null

  // coming back to a table: the same name, and the ticket that gives the seat back
  onMount(() => {
    const i = $shareInfo
    if ($tableMode === 'guest' && i.status === 'closed' && i.ticket) { ticket = i.ticket; if (i.name) name = i.name }
  })

  // the table arrives when the host has the answer: this dialog has done its work
  $: if ($tableMode === 'guest' && $shareInfo.status === 'joined' && answer) dispatch('close')

  async function makeAnswer() {
    error = ''; busy = true
    saveShareSettings({ name, useStun, stunUrl })
    try { answer = await joinTable(invitation, { name: name.trim() || tr('tableShare.defaultGuest'), ticket: ticket ?? undefined, iceServers: iceServersOf({ useStun, stunUrl }) }) }
    catch (err) { error = err.message; answer = '' }
    busy = false
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast(tr('tableShare.copied'), 'info', 1500) } catch { /* the code stays selectable */ }
  }
</script>

<Modal title="{tr('tableShare.joinTitle')}" width={600} on:close>
  <p class="intro">{tr('tableShare.joinIntro')}</p>
  <label class="row">{tr('tableShare.yourName')} <input class="field" bind:value={name} maxlength="30" /></label>
  <label class="check"><input type="checkbox" bind:checked={useStun} /> {tr('tableShare.useHelper')}</label>
  {#if useStun}<label class="row">{tr('tableShare.helperAddress')} <input class="field mono" bind:value={stunUrl} /></label>{/if}

  <label class="stack">{tr('tableShare.joinStep1')}
    <textarea class="code" rows="4" bind:value={invitation} placeholder="{tr('tableShare.invitationPlaceholder')}" disabled={!!answer} aria-label="{tr('tableShare.invitationCode')}" />
  </label>
  {#if !answer}
    <button class="primary" on:click={makeAnswer} disabled={busy || !invitation.trim()}>{busy ? tr('tableShare.making') : tr('tableShare.makeAnswer')}</button>
  {:else}
    <label class="stack">{tr('tableShare.joinStep2')}
      <textarea class="code" readonly rows="4" value={answer} on:focus={e => e.target.select()} aria-label="{tr('tableShare.answerCode')}" />
    </label>
    <button on:click={() => copy(answer)}>{tr('tableShare.copy')}</button>
    <p class="dim" role="status">{$shareInfo.status === 'closed' ? tr('tableShare.didNotConnect') : tr('tableShare.waitingForHost')}</p>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <svelte:fragment slot="footer">
    <span class="spacer" />
    <button on:click={() => dispatch('close')}>{tr('common.cancel')}</button>
  </svelte:fragment>
</Modal>

<style>
  .intro { margin-top: 0; line-height: 1.45; }
  .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .row .field { flex: 1; }
  .check { display: flex; align-items: center; gap: 6px; margin: 8px 0; }
  .stack { display: flex; flex-direction: column; gap: 4px; margin: 10px 0 6px; font-size: 12px; color: var(--color-text-dim); }
  .code { width: 100%; font-family: var(--font-mono); font-size: 11px; resize: vertical; word-break: break-all; }
  .dim { color: var(--color-text-dim); font-size: 12px; }
  .mono { font-family: var(--font-mono); }
  .error { color: var(--color-danger, #c92a2a); margin: 8px 0 0; }
  .spacer { flex: 1; }
</style>
