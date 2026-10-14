<script>
  import { tr } from '../../../shared/i18n.js'
  import { project, activeSet, cardCount } from '../stores/project.js'
  import { saveStatus } from '../stores/ui.js'
</script>

<div class="status-bar" role="region" aria-label="{tr('statusBar.statusBar')}">
  <span class="seg project-name">
    {#if $project}
      {$project.meta?.name ?? tr('statusBar.untitledProject')}
    {:else}{tr('statusBar.noProject')}{/if}
  </span>

  {#if $activeSet}
    <span class="sep">·</span>
    <span class="seg">{$activeSet.name}</span>
    <span class="sep">·</span>
    <span class="seg">{tr('statusBar.cards', { n: $cardCount })}</span>
  {/if}

  <span class="spacer" />

  <span class="seg save-status">{$saveStatus}</span>
</div>

<style>
  .status-bar {
    height: var(--statusbar-height);
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-size: 11px;
    color: var(--color-text-dim);
    flex-shrink: 0;
    gap: 4px;
  }

  .seg { white-space: nowrap; }
  .project-name { font-weight: 600; color: var(--color-text); }
  .sep { color: var(--color-border); }
  .spacer { flex: 1; }
  .save-status { font-style: italic; }
</style>
