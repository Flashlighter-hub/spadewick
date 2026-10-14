<script>
  import { toasts } from '../stores/ui.js'
</script>

<div class="toasts" aria-live="polite">
  {#each $toasts as t (t.id)}
    <div class="toast {t.type}">{t.type === 'error' ? '⚠ ' : ''}{t.message}</div>
  {/each}
</div>

<style>
  .toasts { position: fixed; right: 12px; bottom: 36px; display: flex; flex-direction: column; gap: 6px; z-index: 200; }
  .toast { background: var(--color-surface-2); border: 1px solid var(--color-border); border-left: 4px solid var(--color-accent-text); padding: 8px 12px; border-radius: var(--radius); font-size: 12px; max-width: 380px; box-shadow: var(--shadow-2); }
  .toast.error { border-left-color: var(--color-danger); }
</style>
