import { cpSync } from 'fs'
import { join, resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const EXCALIDRAW_FONTS = resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')

/** Ships Excalidraw's fonts with the app, so drawings never fetch them from a CDN. */
function excalidrawFonts(): Plugin {
  return {
    name: 'excalidraw-fonts',
    writeBundle(options) {
      cpSync(EXCALIDRAW_FONTS, join(options.dir!, 'excalidraw/fonts'), { recursive: true })
    }
  }
}

export default defineConfig({
  main: {},
  // A sandboxed preload cannot load ES modules.
  preload: { build: { rolldownOptions: { output: { format: 'cjs' } } } },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), excalidrawFonts()]
  }
})
