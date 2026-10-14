<script>
  import { tr } from '../../../shared/i18n.js'
  import { activeTab } from '../stores/ui.js'
  import { tableMode } from '../stores/table.js'
  import { project, activeSetId } from '../stores/project.js'
  import CardDataEditor from './CardDataEditor.svelte'
  import TemplateEditor from './TemplateEditor.svelte'
  import AssetBrowser from './AssetBrowser.svelte'
  import TableView from './TableView.svelte'
  import RulesView from './RulesView.svelte'
  import BalanceView from './BalanceView.svelte'
  import SnapshotsPanel from './SnapshotsPanel.svelte'
  import HelpView from './HelpView.svelte'
  import Welcome from './Welcome.svelte'

  const tabs = [
    { id: 'cards',    label: tr('mainPanel.cardData') },
    { id: 'template', label: tr('mainPanel.templateEditor') },
    { id: 'rules',    label: tr('mainPanel.rules') },
    { id: 'table',    label: tr('mainPanel.table') },
    { id: 'balance',  label: tr('mainPanel.balance') },
    { id: 'assets',   label: tr('common.assets') },
    { id: 'snapshots', label: tr('common.snapshots') },
    { id: 'help',     label: tr('mainPanel.help') }
  ]

  // Arrow keys move between tabs (roving tabindex), Home/End jump to the ends
  function onTabKeydown(e) {
    const ids = tabs.map(t => t.id)
    const i = ids.indexOf($activeTab)
    const next = e.key === 'ArrowRight' ? (i + 1) % ids.length : e.key === 'ArrowLeft' ? (i - 1 + ids.length) % ids.length : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : -1
    if (next < 0) return
    e.preventDefault()
    activeTab.set(ids[next])
    document.getElementById(`tab-${ids[next]}`)?.focus()
  }
</script>

<main class="main-panel" aria-label="{tr('mainPanel.workspace')}">
  <h1 class="sr-only">{$project ? tr('mainPanel.headingWithProject', { project: $project.meta?.name ?? tr('mainPanel.untitledProject') }) : tr('common.spadewick')}</h1>
  {#if $project}
    <!-- roving tabindex is on the tabs; the tablist itself is not a tab stop -->
    <!-- svelte-ignore a11y-interactive-supports-focus -->
    <div class="tab-bar" role="tablist" aria-label="{tr('common.views')}" on:keydown={onTabKeydown}>
      {#each tabs as tab}
        <button
          class="tab"
          class:active={$activeTab === tab.id}
          role="tab"
          id="tab-{tab.id}"
          aria-controls="tabpanel"
          tabindex={$activeTab === tab.id ? 0 : -1}
          aria-selected={$activeTab === tab.id}
          on:click={() => activeTab.set(tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="tab-content" id="tabpanel" role="tabpanel" aria-labelledby="tab-{$activeTab}">
      {#if $activeTab === 'cards'}
        {#if $activeSetId}
          <CardDataEditor />
        {:else}
          <div class="hint">{tr('mainPanel.selectOrCreateASet')}</div>
        {/if}
      {:else if $activeTab === 'template'}
        <TemplateEditor />
      {:else if $activeTab === 'rules'}
        <RulesView />
      {:else if $activeTab === 'table'}
        <TableView />
      {:else if $activeTab === 'balance'}
        <BalanceView />
      {:else if $activeTab === 'assets'}
        <AssetBrowser />
      {:else if $activeTab === 'snapshots'}
        <SnapshotsPanel />
      {:else if $activeTab === 'help'}
        <HelpView />
      {/if}
    </div>
  {:else if $activeTab === 'help'}
    <div class="tab-content" id="tabpanel" role="tabpanel" aria-label="{tr('mainPanel.help')}">
      <button class="back" on:click={() => activeTab.set('cards')}>{tr('common.close')}</button>
      <HelpView />
    </div>
  {:else if $tableMode === 'guest'}
    <!-- at somebody else's table: the project is not needed -->
    <div class="tab-content" id="tabpanel" role="tabpanel" aria-label="{tr('mainPanel.table')}">
      <TableView />
    </div>
  {:else}
    <Welcome />
  {/if}
</main>

<style>
  .main-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-bg);
    min-height: 0;
  }

  .tab-bar {
    display: flex;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    padding: 4px 10px 0;
    gap: 4px;
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    border-radius: var(--radius) var(--radius) 0 0;
    padding: 8px 16px 7px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--color-text-dim);
    cursor: pointer;
  }

  .tab:hover {
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
    border-color: transparent;
    border-bottom-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
  }

  .tab.active {
    color: var(--color-text);
    font-weight: 700;
    border-bottom-color: var(--color-accent-text);
    background: linear-gradient(to top, color-mix(in srgb, var(--color-accent) 14%, transparent), transparent);
  }

  .tab-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .back { align-self: flex-end; margin: 6px 10px 0; }

  .hint {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-dim);
    font-size: 13px;
    font-style: italic;
  }
</style>
