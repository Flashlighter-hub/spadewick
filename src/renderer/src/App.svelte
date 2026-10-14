<script>
  import { tr } from '../../shared/i18n.js'
  import { onMount, onDestroy } from 'svelte'
  import Sidebar from './components/Sidebar.svelte'
  import MainPanel from './components/MainPanel.svelte'
  import StatusBar from './components/StatusBar.svelte'
  import ExportDialog from './components/ExportDialog.svelte'
  import FieldManager from './components/FieldManager.svelte'
  import FindReplaceDialog from './components/FindReplaceDialog.svelte'
  import TemplateRulesDialog from './components/TemplateRulesDialog.svelte'
  import InstanceEditorDialog from './components/InstanceEditorDialog.svelte'
  import PreferencesDialog from './components/PreferencesDialog.svelte'
  import FontsDialog from './components/FontsDialog.svelte'
  import IconLibraryDialog from './components/IconLibraryDialog.svelte'
  import TextStylesDialog from './components/TextStylesDialog.svelte'
  import TextCheckDialog from './components/TextCheckDialog.svelte'
  import PreflightDialog from './components/PreflightDialog.svelte'
  import './stores/textLibrary.js'
  import './stores/projectChanges.js'
  import AboutDialog from './components/AboutDialog.svelte'
  import TableJoinDialog from './components/TableJoinDialog.svelte'
  import CardIdsDialog from './components/CardIdsDialog.svelte'
  import TemplateLibraryDialog from './components/TemplateLibraryDialog.svelte'
  import PromptDialog from './components/PromptDialog.svelte'
  import ConfirmDialog from './components/ConfirmDialog.svelte'
  import Toasts from './components/Toasts.svelte'
  import { sidebarVisible, activeTab, previewSize, toast, saveStatus, openDialog, sendCanvasCommand, libraryRequest, showMe, whatChangedRequest, instanceEdit } from './stores/ui.js'
  import { setLayout, loadLayout, PREVIEW_WIDTH } from './stores/layout.js'
  import { project, activeSetId, cards, selectedCardIds, loadSet } from './stores/project.js'
  import { newProject, openProject, closeProject, duplicateProject, revealProject, createSnapshotInteractive } from './stores/actions.js'

  let exportDialogVisible = false
  let exportDialogTab = 'tts'
  let autosaveTimer = null
  let lastSavedAt = null
  let clockTimer = null

  onMount(async () => {
    const settings = await window.spadewick.settings.getAll()
    previewSize.set(settings.preview_size ?? 'medium')
    await loadLayout()
    applyTheme(settings.theme ?? 'system')

    // Re-open last project if one was open
    const state = await window.spadewick.projects.getMeta()
    if (state) project.set(state)

    // PRD §12.4: autosave is a secondary safety net; every edit is already committed
    const seconds = Math.max(5, settings.autosave_interval_seconds ?? 30)
    autosaveTimer = setInterval(autosave, seconds * 1000)
    clockTimer = setInterval(refreshSaveLabel, 5000)

    const on = (channel, fn) => window.spadewick.onMenu(channel, fn)
    const off = [
      on('menu:toggle-sidebar', () => sidebarVisible.update(v => !v)),
      on('menu:preview-size',   (size) => { previewSize.set(size); setLayout('preview', PREVIEW_WIDTH[size] ?? PREVIEW_WIDTH.medium) }),
      on('menu:undo',           handleUndo),
      on('menu:redo',           handleRedo),
      on('menu:new-project',    () => newProject()),
      on('menu:open-project',   () => openProject(null)),
      on('menu:open-project-file', () => openProject(null, { file: true })),
      on('menu:open-recent',    (path) => openProject(path)),
      on('menu:close-project',  closeProject),
      on('menu:duplicate-project', duplicateProject),
      on('menu:reveal-project', revealProject),
      on('menu:preferences',    () => openDialog.set('preferences')),
      on('menu:guide',          () => activeTab.set('help')),
      on('menu:about',          () => openDialog.set('about')),
      on('menu:export-tts',     () => openExportDialog('tts')),
      on('menu:export-pdf',     () => openExportDialog('pdf')),
      on('menu:export-png',     () => openExportDialog('png')),
      on('menu:find-replace',   () => $project && openDialog.set('find-replace')),
      on('menu:select-all',     () => { activeTab.set('cards'); selectedCardIds.set($cards.map(c => c.id)) }),
      on('menu:manage-fields',  () => $activeSetId ? openDialog.set('fields') : toast(tr('toasts.selectASetFirst'), 'info', 2500)),
      on('menu:card-ids',       () => $project && openDialog.set('card-ids')),
      on('menu:manage-fonts',   () => $project && openDialog.set('fonts')),
      on('menu:icons',          () => $project && openDialog.set('icons')),
      on('menu:text-styles',    () => $project && openDialog.set('text-styles')),
      on('menu:check-text',     () => $project && openDialog.set('check-text')),
      on('menu:check-print',    () => $project && openDialog.set('check-print')),
      on('menu:create-snapshot', async () => { if ($project) { await createSnapshotInteractive(); activeTab.set('snapshots') } }),
      on('menu:view-snapshots', () => $project && activeTab.set('snapshots')),
      on('menu:what-changed',   () => { if ($project) { activeTab.set('snapshots'); whatChangedRequest.set(true) } }),
      on('menu:db-integrity',   checkIntegrity),
      on('menu:canvas',         (cmd) => { if ($activeTab === 'template') sendCanvasCommand(cmd) })
    ]
    return () => off.forEach(fn => fn())
  })

  onDestroy(() => { clearInterval(autosaveTimer); clearInterval(clockTimer) })

  async function autosave() {
    if (!$project) return
    saveStatus.set('Saving…')
    try {
      lastSavedAt = await window.spadewick.projects.autosave()
      setTimeout(refreshSaveLabel, 600)
    } catch { saveStatus.set('Autosave failed') }
  }

  function refreshSaveLabel() {
    if (!lastSavedAt) return saveStatus.set('Ready')
    const s = Math.round((Date.now() - lastSavedAt) / 1000)
    saveStatus.set(s < 10 ? 'Saved just now' : s < 60 ? `Saved ${s}s ago` : `Saved ${Math.round(s / 60)} min ago`)
  }

  // A visible editor with its own edit history (the template editor) gets the first chance to
  // handle Undo/Redo, so in-progress edits are never mixed up with changes to other project data.
  async function handleUndo() {
    if (!window.dispatchEvent(new CustomEvent('spadewick:undo', { cancelable: true }))) return
    const ok = await window.spadewick.history.undo()
    if (ok) { await loadSet($activeSetId); window.dispatchEvent(new Event('spadewick:history-applied')); toast(tr('toasts.undone'), 'info', 1500) }
  }

  async function handleRedo() {
    if (!window.dispatchEvent(new CustomEvent('spadewick:redo', { cancelable: true }))) return
    const ok = await window.spadewick.history.redo()
    if (ok) { await loadSet($activeSetId); window.dispatchEvent(new Event('spadewick:history-applied')); toast(tr('toasts.redone'), 'info', 1500) }
  }

  async function checkIntegrity() {
    if (!$project) return
    const ok = await window.spadewick.projects.checkIntegrity()
    toast(ok ? tr('toasts.integrityPassed') : tr('toasts.integrityFailed'), ok ? 'info' : 'error', 6000)
  }

  function openExportDialog(tab) {
    exportDialogTab = tab
    exportDialogVisible = true
  }

  function applyTheme(theme) {
    const root = document.documentElement
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme
    // The colours change at once, not as a slow fade of every control
    root.classList.add('theme-switching')
    root.setAttribute('data-theme', resolved)
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')))
  }

  const close = () => openDialog.set(null)
</script>

<div class="app-shell">
  {#if $sidebarVisible}
    <Sidebar />
  {/if}
  <div class="main-area">
    <MainPanel />
    <StatusBar />
  </div>
</div>

<ExportDialog
  bind:visible={exportDialogVisible}
  initialTab={exportDialogTab}
  on:close={() => exportDialogVisible = false}
/>

{#if $openDialog === 'fields'}<FieldManager visible on:close={close} />{/if}
{#if $openDialog === 'find-replace'}<FindReplaceDialog on:close={close} />{/if}
{#if $instanceEdit}<InstanceEditorDialog cardId={$instanceEdit} on:close={() => instanceEdit.set(null)} />{/if}
{#if $openDialog === 'template-rules'}<TemplateRulesDialog on:close={close} />{/if}
{#if $openDialog === 'preferences'}<PreferencesDialog {applyTheme} on:close={close} />{/if}
{#if $openDialog === 'fonts'}<FontsDialog on:close={close} />{/if}
{#if $openDialog === 'icons'}<IconLibraryDialog on:close={close} />{/if}
{#if $openDialog === 'text-styles'}<TextStylesDialog on:close={close} />{/if}
{#if $openDialog === 'check-text'}<TextCheckDialog on:close={close} />{/if}
{#if $openDialog === 'check-print'}<PreflightDialog on:close={close} on:show={e => showMe(e.detail)} />{/if}
{#if $openDialog === 'template-library'}<TemplateLibraryDialog request={$libraryRequest ?? { intent: 'browse' }} on:close={close} />{/if}
{#if $openDialog === 'card-ids'}<CardIdsDialog on:close={close} />{/if}
{#if $openDialog === 'about'}<AboutDialog on:close={close} />{/if}
{#if $openDialog === 'table-join'}<TableJoinDialog on:close={close} />{/if}
<PromptDialog />
<ConfirmDialog />
<Toasts />

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  /* ---- The look: tokens ----
     Dark is the default. --color-border is the soft line between areas; --color-control-border is the stronger edge of
     buttons and fields, kept at 3:1 against its surface (WCAG 1.4.11). */
  :global(:root) {
    --color-bg:           #0d0f17;
    --color-surface:      #151824;
    --color-surface-2:    #1e2233;
    --color-border:       #2b3148;
    --color-control-border: #6a7194;
    --color-text:         #e8eaf6;
    --color-text-dim:     #a3a9c6;
    --color-accent:       #5b4cf0;
    --color-accent-hover: #6d5ff5;
    --color-accent-text:  #a9a3ff;
    --color-on-accent:    #ffffff;
    --color-danger:       #d03b4d;
    --color-danger-text:  #ff93a0;
    --syn-tag: #6cb6ff; --syn-attr: #d7ba7d; --syn-string: #e0a48a; --syn-comment: #86b386; --syn-token: #4ec9b0;
    --color-success:      #2fb36d;
    --color-success-text: #6fd3a0;
    --color-warning:      #e0902f;
    --color-warning-text: #f0b45a;
    --color-surface-hover: color-mix(in srgb, var(--color-text) 10%, transparent);
    --color-selected:     color-mix(in srgb, var(--color-accent) 24%, transparent);
    --gradient-accent:    linear-gradient(135deg, #5546e0 0%, #7448e8 100%);
    --glow:               0 6px 18px -6px rgba(110, 90, 255, .65);
    --shadow-1:           0 1px 2px rgba(0, 0, 0, .35);
    --shadow-2:           0 8px 28px rgba(0, 0, 0, .45);
    --statusbar-height:   24px;
    --font-ui:            'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    --font-mono:          'Cascadia Code', 'Cascadia Mono', 'Fira Code', 'Consolas', monospace;
    --radius:             8px;
    --radius-sm:          5px;
    --radius-lg:          14px;
    --radius-md:          8px;
    --font-size-control:  12px;
    color-scheme: dark;
  }

  :global(:root[data-theme="light"]) {
    --color-bg:          #f2f3fa;
    --color-surface:     #ffffff;
    --color-surface-2:   #e9ebf6;
    --color-border:      #dcdfee;
    --color-control-border: #878da8;
    --color-text:        #1a1c2b;
    --color-text-dim:    #565b76;
    --color-accent:      #5546e0;
    --color-accent-hover:#4637c9;
    --color-accent-text: #4636d2;
    --color-danger-text: #b3202f;
    --color-success-text: #1d7a48;
    --color-warning:     #c97a14;
    --color-warning-text: #8a5a00;
    --syn-tag: #0a4f9c; --syn-attr: #7a4d00; --syn-string: #a31515; --syn-comment: #3d6b3d; --syn-token: #006456;
    --glow:              0 6px 16px -6px rgba(85, 70, 224, .55);
    --shadow-1:          0 1px 2px rgba(30, 30, 80, .12);
    --shadow-2:          0 10px 32px rgba(30, 30, 80, .22);
    color-scheme: light;
  }

  /* Users who ask the OS for more contrast get stronger borders and text */
  @media (prefers-contrast: more) {
    :global(:root)                 { --color-border: #ffffff; --color-control-border: #ffffff; --color-text: #ffffff; --color-text-dim: #e0e0e0; }
    :global(:root[data-theme="light"]) { --color-border: #000000; --color-control-border: #000000; --color-text: #000000; --color-text-dim: #1a1a1a; }
  }

  /* Windows High Contrast / forced colours: rely on system colours and shapes, not our palette */
  @media (forced-colors: active) {
    :global(button), :global(input), :global(select), :global(textarea) { border: 1px solid ButtonText; }
    :global(.grid-row.selected) { outline: 2px solid Highlight; outline-offset: -2px; }
    :global(.cell.active) { outline: 3px solid Highlight; }
    :global(.set-row.active), :global(.view-item.active), :global(.tab.active) { forced-color-adjust: none; background: Highlight; color: HighlightText; }
    :global(.swatch), :global(.sw) { forced-color-adjust: none; border: 1px solid CanvasText; }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(*), :global(*::before), :global(*::after) { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
  }

  :global(.theme-switching *), :global(.theme-switching *::before), :global(.theme-switching *::after) { transition: none !important; }

  /* Text for screen readers only */
  :global(.sr-only) { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

  /* Every control shows where keyboard focus is */
  :global(:focus-visible) { outline: 2px solid var(--color-accent-text); outline-offset: 2px; border-radius: var(--radius-sm); }
  :global(input:focus-visible), :global(select:focus-visible), :global(textarea:focus-visible) { outline-offset: 0; }

  :global(::selection) { background: color-mix(in srgb, var(--color-accent) 38%, transparent); }

  /* Slim scroll bars that follow the theme */
  :global(*) { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--color-text-dim) 45%, transparent) transparent; }
  :global(::-webkit-scrollbar) { width: 11px; height: 11px; }
  :global(::-webkit-scrollbar-track) { background: transparent; }
  :global(::-webkit-scrollbar-thumb) { background: color-mix(in srgb, var(--color-text-dim) 40%, transparent); border-radius: 8px; border: 3px solid transparent; background-clip: padding-box; }
  :global(::-webkit-scrollbar-thumb:hover) { background: color-mix(in srgb, var(--color-text-dim) 65%, transparent); background-clip: padding-box; border: 3px solid transparent; }
  :global(::-webkit-scrollbar-corner) { background: transparent; }

  :global(body) {
    background: var(--color-bg);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.35;
    overflow: hidden;
    height: 100vh;
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }

  :global(button) {
    font-family: inherit;
    font-size: var(--font-size-control);
    cursor: pointer;
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-control-border);
    border-radius: var(--radius);
    padding: 4px 12px;
    transition: background-color .12s ease, border-color .12s ease, box-shadow .12s ease, color .12s ease, transform .06s ease;
  }

  :global(button:hover) {
    background: var(--color-surface-2);
    border-color: var(--color-accent-text);
  }

  :global(button:active) { transform: translateY(1px); }
  :global(button:disabled) { opacity: .5; cursor: not-allowed; transform: none; }

  /* The main call to action of a dialog or screen */
  :global(button.primary-btn), :global(button.primary), :global(button.dirty) {
    background: var(--gradient-accent);
    color: var(--color-on-accent);
    border-color: transparent;
    font-weight: 600;
    box-shadow: var(--glow);
  }
  :global(button.primary-btn:hover), :global(button.primary:hover), :global(button.dirty:hover) {
    background: var(--gradient-accent);
    filter: brightness(1.12);
    border-color: transparent;
  }
  :global(button.primary-btn:disabled), :global(button.primary:disabled) { box-shadow: none; filter: grayscale(.4); }

  :global(button.danger-btn) { background: var(--color-danger); border-color: transparent; color: #fff; }

  :global(input, textarea, select) {
    font-family: inherit;
    font-size: var(--font-size-control);
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-control-border);
    border-radius: var(--radius);
    padding: 4px 8px;
    outline: none;
    transition: border-color .12s ease, box-shadow .12s ease;
  }

  :global(input:hover:not(:disabled), textarea:hover:not(:disabled), select:hover:not(:disabled)) { border-color: var(--color-accent-text); }

  :global(input:focus, textarea:focus, select:focus) {
    border-color: var(--color-accent-text);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 28%, transparent);
  }

  :global(input[type="checkbox"], input[type="radio"]) { accent-color: var(--color-accent); vertical-align: -2px; margin-right: 5px; cursor: pointer; }
  :global(label:has(> input[type="checkbox"]), label:has(> input[type="radio"])) { cursor: pointer; }
  :global(select) { cursor: pointer; }
  :global(input[type="range"]) { accent-color: var(--color-accent); padding: 0; box-shadow: none; }
  :global(input[type="color"]) { padding: 2px; }

  .app-shell {
    display: flex;
    height: 100vh;
    overflow: hidden;
    background: var(--color-bg);
  }

  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }
</style>
