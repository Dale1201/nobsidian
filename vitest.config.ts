import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared') }
  },
  test: {
    environment: 'node',
    env: { TZ: 'UTC' },
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'out', 'dist', 'e2e']
  }
})
