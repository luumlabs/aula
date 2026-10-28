import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Pruebas de la cadena de vídeo: npx vitest run --config scripts/video/vitest.config.ts
export default defineConfig({
  test: { root: fileURLToPath(new URL('.', import.meta.url)), include: ['**/*.test.ts'], exclude: ['work/**', 'node_modules/**'], environment: 'node', testTimeout: 60000 }
})
