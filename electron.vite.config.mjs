import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // The command line (PRD §21) is a second entry of the main process bundle: out/main/cli.js; the drawing helper (safeRaster.js) is a third
    build: { rollupOptions: { input: { index: resolve('src/main/index.js'), cli: resolve('src/cli/index.js'), rasterWorker: resolve('src/main/rasterWorker.js') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [svelte()]
  }
})
