<script>
  import { tr } from '../../../shared/i18n.js'
  import { newProject, openProject } from '../stores/actions.js'
  import { openDialog } from '../stores/ui.js'

  let recentProjects = []

  async function loadRecents() {
    recentProjects = await window.spadewick.projects.listRecent()
  }

  loadRecents()
</script>

<div class="welcome">
  <div class="logo">{tr('common.spadewick')}</div>
  <p class="tagline">{tr('welcome.localFirstCardGameDesign')}</p>

  <div class="actions">
    <button class="primary-btn" on:click={newProject}>{tr('welcome.newProject')}</button>
    <button on:click={() => openProject(null)}>{tr('welcome.openProject')}</button>
    <button on:click={() => openDialog.set('table-join')}>{tr('tableShare.joinFromWelcome')}</button>
  </div>

  {#if recentProjects.length}
    <div class="recent">
      <h2>{tr('welcome.recentProjects')}</h2>
      <ul>
        {#each recentProjects as path}
          <li>
            <button class="recent-item" on:click={() => openProject(path)}>
              {path.split('/').pop() || path.split('\\').pop() || path}
              <span class="path">{path}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .welcome {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 40px;
    background: radial-gradient(700px 360px at 50% 38%, color-mix(in srgb, var(--color-accent) 20%, transparent), transparent 70%);
  }

  .logo {
    font-size: 52px;
    font-weight: 800;
    letter-spacing: -2px;
    color: var(--color-text);
    padding-bottom: 14px;
    position: relative;
  }

  .logo::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 64px;
    height: 5px;
    margin-left: -32px;
    border-radius: 3px;
    background: var(--gradient-accent);
    box-shadow: var(--glow);
  }

  .tagline {
    color: var(--color-text-dim);
    font-size: 15px;
    margin-top: -4px;
  }

  .actions {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }

  .actions button { padding: 8px 22px; font-size: 14px; border-radius: var(--radius); }

  .recent {
    width: 100%;
    max-width: 420px;
    margin-top: 16px;
  }

  .recent h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-dim);
    margin-bottom: 8px;
  }

  ul { list-style: none; }

  .recent-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: none;
    border: none;
    width: 100%;
    padding: 6px 10px;
    border-radius: var(--radius);
    text-align: left;
    color: var(--color-text);
  }

  .recent-item:hover { background: var(--color-surface); box-shadow: var(--shadow-1); }

  .path {
    font-size: 10px;
    color: var(--color-text-dim);
    font-family: var(--font-mono);
    margin-top: 1px;
  }
</style>
