import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { thirdPartyLicenses } from './scripts/build/third-party-licenses'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@engine': resolve(__dirname, 'src/engine'),
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
}

export default defineConfig({
  main: {
    // thirdPartyLicenses: avisos de licencia de lo que va dentro de la app → out/THIRD_PARTY_LICENSES.txt
    plugins: [externalizeDepsPlugin(), thirdPartyLicenses('main', { production: true })],
    resolve: { alias },
    // compilación de auditoría: la app empaquetada acepta --remote-debugging-port (src/main/electron/debug-guard.ts)
    define: { __AULA_AUDIT_BUILD__: JSON.stringify(process.env.AULA_AUDIT_BUILD === '1') },
    build: {
      // electron-vite 6 no minifica por defecto: −1,9 MB en el asar y menos que leer al arrancar (J4-5)
      minify: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'aula-mcp': resolve(__dirname, 'src/main/mcp/aula-mcp.ts'),
          'ingest-worker': resolve(__dirname, 'src/main/ingest-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), thirdPartyLicenses('preload')],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          browser: resolve(__dirname, 'src/preload/browser.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react(), tailwindcss(), thirdPartyLicenses('renderer', { css: ['src/renderer/src/styles.css'] })],
    build: {
      // minificada: −4,6 MB de JavaScript (un 40 %), en el asar y en cada actualización (J4-5)
      minify: 'esbuild',
      chunkSizeWarningLimit: 4000,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html'), raster: resolve(__dirname, 'src/renderer/raster.html') } }
    }
  }
})
