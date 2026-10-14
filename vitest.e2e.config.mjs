import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'

export default defineConfig({
  resolve: { alias: { electron: fileURLToPath(new URL('./tests/helpers/electron-mock.js', import.meta.url)) } },
  test: {
    include: ['tests/e2e/**/*.e2e.test.js'],
    globalSetup: ['tests/e2e/global-setup.mjs'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // one app instance at a time: the active project is global state
    fileParallelism: false,
    testTimeout: 40000,
    hookTimeout: 90000
  }
})
