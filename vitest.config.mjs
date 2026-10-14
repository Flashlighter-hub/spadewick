import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'

export default defineConfig({
  resolve: { alias: { electron: fileURLToPath(new URL('./tests/helpers/electron-mock.js', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
