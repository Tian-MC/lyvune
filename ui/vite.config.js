import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const frontendPort = parseInt(process.env.PORT) || 4533
const backendPort = frontendPort + 100

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    kuromojiDictionary(),
    VitePWA({
      manifest: manifest(),
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB
        // index.html is rendered per-user by the server, so a precached copy
        // would pin one user's config (and auth payload) across logins
        globIgnores: ['index.html', 'kuromoji-dict/**'],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  server: {
    host: true,
    port: frontendPort,
    proxy: {
      '^/(auth|api|rest|backgrounds)/.*': 'http://localhost:' + backendPort,
    },
  },
  base: './',
  define: {
    // JSONForms and other libraries use process.env
    'process.env': JSON.stringify({}),
  },
  build: {
    outDir: 'build',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    css: true,
    reporters: ['verbose'],
    // reporters: ['default', 'hanging-process'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*'],
      exclude: [],
    },
  },
})

// PWA manifest
function manifest() {
  return {
    name: 'Lyvune',
    short_name: 'Lyvune',
    description:
      'Lyvune, an open source web-based music collection server and streamer',
    categories: ['music', 'entertainment'],
    display: 'standalone',
    start_url: './',
    background_color: '#06241c',
    theme_color: '#0a1110',
    icons: [
      {
        src: './android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: './android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}

// The Japanese romanizer reads kuromoji's dictionary over HTTP. It is copied
// from the npm package instead of being kept in the repository, and fetched
// only when a song with kanji is romanized.
function kuromojiDictionary() {
  const dir = join('node_modules', 'kuromoji', 'dict')
  const prefix = '/kuromoji-dict/'
  return {
    name: 'kuromoji-dictionary',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        if (!url.startsWith(prefix) || url.includes('..')) return next()
        try {
          res.setHeader('Content-Type', 'application/octet-stream')
          res.end(readFileSync(join(dir, url.slice(prefix.length))))
        } catch {
          next()
        }
      })
    },
    generateBundle() {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.dat.gz')) continue
        this.emitFile({
          type: 'asset',
          fileName: `kuromoji-dict/${name}`,
          source: readFileSync(join(dir, name)),
        })
      }
      // The dictionary is mecab-ipadic, whose licence requires its notice and
      // the Apache licence of kuromoji to travel with every copy
      for (const name of ['NOTICE.md', 'LICENSE-2.0.txt']) {
        this.emitFile({
          type: 'asset',
          fileName: `kuromoji-dict/${name}`,
          source: readFileSync(join('node_modules', 'kuromoji', name)),
        })
      }
    },
  }
}
