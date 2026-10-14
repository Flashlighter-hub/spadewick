<script>
  import { askConfirm } from '../stores/prompt.js'
  import { tr } from '../../../shared/i18n.js'
  import { onMount, onDestroy } from 'svelte'
  import { createSnapshotInteractive } from '../stores/actions.js'
  import { project, activeSetId, loadSet, refreshProject } from '../stores/project.js'
  import { toast, whatChangedRequest } from '../stores/ui.js'
  import SnapshotCompare from './SnapshotCompare.svelte'

  let comparing = null      // { from, to } while a comparison is open
  let picking = null        // the snapshot whose second side is being chosen
  let pickedTo = ''
  let asking = false        // Project > What Changed Since...: choose the snapshot to compare the project with
  let askedFor = ''
  $: if ($whatChangedRequest) { asking = true; whatChangedRequest.set(false) }
  $: if (asking && !askedFor && snapshots.length) askedFor = snapshots[0].id

  let snapshots = []

  const reload = async () => { snapshots = await window.spadewick.snapshots.list() }
  onMount(() => { reload(); window.addEventListener('spadewick:snapshots-changed', reload) })
  onDestroy(() => window.removeEventListener('spadewick:snapshots-changed', reload))

  const create = () => createSnapshotInteractive()

  async function restore(s) {
    if (!await askConfirm(tr('snapshotsPanel.confirmRestore', { name: s.name }))) return
    try {
      await window.spadewick.snapshots.restore(s.id)
      await refreshProject()
      await loadSet($activeSetId)
      toast(tr('snapshotsPanel.restored'), 'info', 2500)
      await reload()
    } catch (err) { toast(tr('snapshotsPanel.restoreFailed', { reason: err.message }), 'error', 5000) }
  }

  async function remove(s) {
    if (!await askConfirm(tr('snapshotsPanel.confirmDelete', { name: s.name }))) return
    await window.spadewick.snapshots.delete(s.id); await reload()
  }

  async function exportSnap(s) {
    try { await window.spadewick.snapshots.export(s.id) }
    catch (err) { toast(err.message, 'error', 5000) }
  }
</script>

{#if comparing}
  <SnapshotCompare from={comparing.from} to={comparing.to} on:close={() => (comparing = null)} />
{:else}
<div class="panel">
  <div class="bar"><strong>{tr('common.snapshots')}</strong><span class="spacer" /><button on:click={create}>{tr('snapshotsPanel.createSnapshot')}</button></div>
  {#if asking}
    <div class="ask" role="group" aria-label={tr('compare.sinceMenu')}>
      <label>{tr('compare.sinceMenu')} <select bind:value={askedFor}>{#each snapshots as o (o.id)}<option value={o.id}>{o.name}</option>{/each}</select></label>
      <button disabled={!askedFor} on:click={() => { comparing = { from: snapshots.find(o => o.id === askedFor), to: null }; asking = false }}>{tr('compare.pick')}</button>
      <button on:click={() => (asking = false)}>{tr('compare.close')}</button>
    </div>
  {/if}
  <ul>
    {#each snapshots as s (s.id)}
      <li>
        <div class="info"><b>{s.name}</b><span class="dim">{new Date(s.created_at).toLocaleString()}</span>{#if s.description}<span class="dim">{s.description}</span>{/if}</div>
        <button on:click={() => (comparing = { from: s, to: null })}>{tr('snapshotsPanel.whatChanged')}</button>
        {#if picking === s.id}
          <select bind:value={pickedTo} aria-label={tr('compare.pickSecond')}>
            <option value="">{tr('compare.pickNow')}</option>
            {#each snapshots.filter(o => o.id !== s.id) as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
          </select>
          <button on:click={() => { const other = snapshots.find(o => o.id === pickedTo) ?? null; const [a, b] = other && other.created_at < s.created_at ? [other, s] : [s, other]; comparing = { from: a, to: b }; picking = null }}>{tr('compare.pick')}</button>
        {:else}
          <button on:click={() => { picking = s.id; pickedTo = '' }}>{tr('snapshotsPanel.compare')}</button>
        {/if}
        <button on:click={() => restore(s)}>{tr('snapshotsPanel.restore')}</button>
        <button on:click={() => exportSnap(s)}>{tr('common.export2')}</button>
        <button on:click={() => remove(s)} aria-label="{tr('snapshotsPanel.deleteSnapshot', { name: s.name })}">🗑</button>
      </li>
    {:else}
      <li class="dim">{tr('snapshotsPanel.noSnapshotsYetSnapshotBefore')}</li>
    {/each}
  </ul>
</div>
{/if}

<style>
  .panel { flex: 1; overflow: auto; }
  .bar { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
  .spacer { flex: 1; }
  .ask { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--color-border); font-size: 12px; }
  ul { list-style: none; }
  li { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); font-size: 12px; }
  .info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .dim { color: var(--color-text-dim); font-size: 11px; }
</style>
