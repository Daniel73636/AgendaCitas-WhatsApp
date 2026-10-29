/* Service worker de Agenda de citas.
 * - Precachea la pagina offline y los iconos.
 * - Navegacion: red primero; si no hay red, muestra la ultima copia o /offline.
 * - Estaticos de Next (/_next/static) e iconos: cache primero (inmutables).
 * - Nunca cachea llamadas a la API (otro origen / puerto): los datos siempre son en vivo. */
const VERSION = 'agenda-v1';
const STATIC_CACHE = `${VERSION}-static`;
const PAGES_CACHE = `${VERSION}-pages`;
const PRECACHE = ['/offline', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API u otros origenes: sin intervencion

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGES_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/offline')) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});

// Notificaciones push (preparado para Web Push; el envio real se conecta en produccion)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Agenda', body: 'Tienes una novedad' };
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: data.url || '/hoy' }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data || '/hoy'));
});
