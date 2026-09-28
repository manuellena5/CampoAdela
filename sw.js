// Service Worker: precache de todos los assets (offline-first).
// La versión llega por query string (sw.js?v=X.Y.Z), que la toma de js/config.js,
// así no hay que actualizarla a mano en este archivo.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `campo-v${VERSION}`;

// Al agregar archivos a la app, sumarlos acá.
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'vendor/dexie.min.js',
  'js/config.js',
  'js/app.js',
  'js/router.js',
  'js/db.js',
  'js/seed.js',
  'js/sync.js',
  'js/ajustes.js',
  'js/actualizacion.js',
  'js/lib/dom.js',
  'js/lib/dialogo.js',
  'js/lib/formato.js',
  'js/ui/movimientos.js',
  'js/ui/movimientoForm.js',
  'js/ui/campanas.js',
  'js/ui/categorias.js',
  'js/ui/hermanos.js',
  'js/ui/mas.js',
  'js/ui/configuracion.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: 'reload' evita tomar archivos viejos de la caché HTTP.
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('campo-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // APIs externas: directo a la red
  if (url.pathname.endsWith('/version.json')) return; // siempre de la red

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      const index = await cache.match(new URL('index.html', self.registration.scope).href);
      if (index) return index;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
