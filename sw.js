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
  'js/dolar.js',
  'js/dominio.js',
  'js/calculos.js',
  'js/api.js',
  'js/errores.js',
  'js/ui/registroErrores.js',
  'js/ui/panelSync.js',
  'js/storage.js',
  'js/importacion.js',
  'js/lib/csv.js',
  'js/lib/zip.js',
  'js/lib/xlsx.js',
  'js/plantilla.js',
  'js/ui/importar.js',
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
  'js/ui/resumen.js',
  'js/ui/cuentas.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

// Cada archivo se pide con ?v=VERSION: para la CDN de GitHub Pages (que cachea hasta 10 min) es una URL
// nueva, así nunca se guarda una copia vieja. Se guarda en el cache sin el ?v, con la URL normal.
async function precachear() {
  await caches.delete(CACHE); // por si quedó una instalación a medias
  const cache = await caches.open(CACHE);
  await Promise.all(ASSETS.map(async (ruta) => {
    const url = new URL(ruta, self.registration.scope);
    const pedido = new URL(url);
    pedido.searchParams.set('v', VERSION);
    const resp = await fetch(pedido, { cache: 'reload' });
    if (!resp.ok) throw new Error(`No se pudo descargar ${ruta} (${resp.status})`);
    await cache.put(url.href, resp);
  }));
  // Verificación: la versión del código descargado tiene que ser la que se está instalando.
  if (VERSION !== 'dev') {
    const config = await (await cache.match(new URL('js/config.js', self.registration.scope).href)).text();
    if (!config.includes(`APP_VERSION = '${VERSION}'`)) {
      await caches.delete(CACHE);
      throw new Error(`js/config.js no corresponde a la versión ${VERSION}`);
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precachear());
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
