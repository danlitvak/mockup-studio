/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Emits a service worker that precaches the real build output.
 *
 * Written by hand rather than pulled from Workbox: the app has no network
 * dependencies at all, so "cache everything at install, serve cache first" is
 * the whole strategy, and a generated asset list keeps it honest across builds.
 */
function offlineServiceWorker(): Plugin {
  return {
    name: 'offline-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .map((name) => `/${name}`)
        .filter((name) => !name.endsWith('.map'));
      const precache = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', ...assets];
      const version = String(Date.now());

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Generated at build time — do not edit.
const CACHE = 'mockup-studio-${version}';
const PRECACHE = ${JSON.stringify([...new Set(precache)], null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // A navigation with no cache entry still gets the app shell.
          if (request.mode === 'navigate') return caches.match('/index.html');
          throw new Error('offline');
        });
    })
  );
});
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineServiceWorker()],
  server: { port: 5173 },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Three.js and the muxer are large and change rarely; keeping them in
        // their own chunks means an app-code change does not re-download them.
        manualChunks: {
          three: ['three'],
          mediabunny: ['mediabunny'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    reporters: ['default'],
  },
});
