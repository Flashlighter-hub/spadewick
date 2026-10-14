<script>
  import { tr } from '../../../shared/i18n.js'
  /**
   * Sharing the table (PRD §22.0), host's side: start sharing, invite players one at a time by trading codes, see who is at the table, and
   * stop. Nothing goes through a server; the players do not need the project (the cards and pictures are sent from here).
   */
  import { createEventDispatcher, onDestroy } from 'svelte'
  import Modal from './Modal.svelte'
  import { tableMode, shareInfo, startHosting, stopHosting, hosting } from '../stores/table.js'
  import { toast } from '../stores/ui.js'
  import { loadShareSettings, saveShareSettings, iceServersOf } from '../lib/shareSettings.js'

  const dispatch = createEventDispatcher()
  const saved = loadShareSettings()
  let name = saved.name || tr('tableShare.defaultHost')
  let useStun = saved.useStun
  let stunUrl = saved.stunUrl
  let invite = null            // { id, code }
  let answer = ''
  let error = ''
  let busy = false

  $: sharing = $tableMode === 'host'
  $: players = $shareInfo.players
  $: waiting = $shareInfo.peers.filter(p => p.state === 'invited' || p.state === 'connecting')

  function start() {
    saveShareSettings({ name, useStun, stunUrl })
    startHosting({ name: name.trim() || tr('tableShare.defaultHost'), iceServers: iceServersOf({ useStun, stunUrl }) })
  }

  async function makeInvitation() {
    error = ''; busy = true
    try { invite = await hosting().invite(); answer = '' } catch (err) { error = err.message }
    busy = false
  }

  async function connect() {
    if (!invite) return
    error = ''; busy = true
    try { await hosting().accept(invite.id, answer); invite = null; answer = '' }
    catch (err) { error = err.message; if (err.code && err.code !== 'format' && err.code !== 'checksum' && err.code !== 'kind') invite = null }
    busy = false
  }

  function cancelInvitation() { if (invite) hosting()?.cancel(invite.id); invite = null; answer = ''; error = '' }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast(tr('tableShare.copied'), 'info', 1500) } catch { /* the code stays selectable */ }
  }

  function stop() { stopHosting(); invite = null; dispatch('close') }
  onDestroy(() => { if (invite && hosting()) hosting().cancel(invite.id) })
</script>

<Modal title="{tr('tableShare.title')}" width={620} on:close>
  {#if !sharing}
    <p class="intro">{tr('tableShare.intro')}</p>
    <label class="row">{tr('tableShare.yourName')} <input class="field" bind:value={name} maxlength="30" /></label>
    <label class="check"><input type="checkbox" bind:checked={useStun} /> {tr('tableShare.useHelper')}</label>
    {#if useStun}
      <label class="row">{tr('tableShare.helperAddress')} <input class="field mono" bind:value={stunUrl} /></label>
      <p class="dim">{tr('tableShare.helperNote')}</p>
    {:else}
      <p class="dim">{tr('tableShare.sameNetwork')}</p>
    {/if}
  {:else}
    <h3>{tr('tableShare.atTheTable')}</h3>
    <ul class="players" aria-label="{tr('tableShare.atTheTable')}">
      {#each players as p (p.peer ?? `away-${p.seat}`)}
        <li class:away={p.away}>
          <span class="who">{p.name}{p.peer === 'host' ? ` ${tr('tableShare.you')}` : ''}{p.away ? ` ${tr('tableShare.away')}` : ''}</span>
          <span class="seat">{p.seat === null ? tr('tableShare.watching') : tr('table.hand', { seat: p.seat + 1 })}</span>
          {#if p.away}
            <button on:click={() => hosting().release(p.seat)} aria-label="{tr('tableShare.freeSeatFor', { name: p.name })}">{tr('tableShare.freeSeat')}</button>
          {:else if p.peer && p.peer !== 'host'}
            <button on:click={() => hosting().kick(p.peer)} aria-label="{tr('tableShare.sendAwayName', { name: p.name })}">{tr('tableShare.sendAway')}</button>
          {/if}
        </li>
      {/each}
    </ul>
    {#each waiting as w (w.id)}<p class="dim" role="status">{w.state === 'invited' ? tr('tableShare.waitingForAnswer') : tr('tableShare.connecting')}</p>{/each}

    <h3>{tr('tableShare.invite')}</h3>
    {#if !invite}
      <p class="dim">{tr('tableShare.inviteHelp')}</p>
      <button on:click={makeInvitation} disabled={busy}>{busy ? tr('tableShare.making') : tr('tableShare.newInvitation')}</button>
    {:else}
      <label class="stack">{tr('tableShare.step1')}
        <textarea class="code" readonly rows="4" value={invite.code} on:focus={e => e.target.select()} aria-label="{tr('tableShare.invitationCode')}" />
      </label>
      <button on:click={() => copy(invite.code)}>{tr('tableShare.copy')}</button>
      <label class="stack">{tr('tableShare.step2')}
        <textarea class="code" rows="4" bind:value={answer} placeholder="{tr('tableShare.answerPlaceholder')}" aria-label="{tr('tableShare.answerCode')}" />
      </label>
      <div class="row-buttons">
        <button class="primary" on:click={connect} disabled={busy || !answer.trim()}>{busy ? tr('tableShare.connecting') : tr('tableShare.connect')}</button>
        <button on:click={cancelInvitation}>{tr('common.cancel')}</button>
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}

  <svelte:fragment slot="footer">
    {#if sharing}<button on:click={stop}>{tr('tableShare.stop')}</button>{/if}
    <span class="spacer" />
    {#if !sharing}<button class="primary" on:click={start}>{tr('tableShare.start')}</button>{/if}
    <button on:click={() => dispatch('close')}>{sharing ? tr('common.done') : tr('common.cancel')}</button>
  </svelte:fragment>
</Modal>

<style>
  .intro { margin-top: 0; line-height: 1.45; }
  .row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .row .field { flex: 1; }
  .check { display: flex; align-items: center; gap: 6px; margin: 8px 0; }
  .stack { display: flex; flex-direction: column; gap: 4px; margin: 8px 0 4px; font-size: 12px; color: var(--color-text-dim); }
  .code { width: 100%; font-family: var(--font-mono); font-size: 11px; resize: vertical; word-break: break-all; }
  .dim { color: var(--color-text-dim); font-size: 12px; }
  .mono { font-family: var(--font-mono); }
  h3 { margin: 14px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--color-text-dim); }
  .players { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .players li { display: flex; align-items: center; gap: 10px; padding: 4px 8px; border: 1px solid var(--color-border); border-radius: var(--radius); }
  .players li.away { opacity: .7; border-style: dashed; }
  .who { flex: 1; font-weight: 600; }
  .seat { color: var(--color-text-dim); font-size: 12px; }
  .row-buttons { display: flex; gap: 8px; margin: 6px 0; }
  .error { color: var(--color-danger, #c92a2a); margin: 8px 0 0; }
  .spacer { flex: 1; }
</style>
