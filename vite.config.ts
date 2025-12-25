import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const isServe = command === 'serve'
  const isBuild = command === 'build'

  return {
    plugins: [
      vue(),
      electron([
        {
          entry: 'electron/main.ts',
          onstart(options) {
            options.startup()
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              minify: isBuild,
              rollupOptions: {
                external: [
                  'electron',
                  'node-windows',
                  'sudo-prompt',
                  'electron-store',
                  'unzipper',
                  'fs',
                  'path',
                  'child_process',
                  'https',
                  'http',
                  'stream',
                  'util'
                ]
              }
            }
          }
        },
        {
          entry: 'electron/preload.ts',
          onstart(options) {
            options.reload()
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              minify: isBuild
            }
          }
        }
      ]),
      renderer()
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    server: {
      port: 5173
    },
    clearScreen: false
  }
})

