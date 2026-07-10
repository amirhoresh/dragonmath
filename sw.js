/* DragonMath service worker — network-first so updates always reach the device
   when online, with a cached app shell as offline fallback. */
const CACHE = 'dragonmath-v19';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './fonts/varelaround-hebrew.woff2',
  './fonts/varelaround-latin.woff2',
  './assets/phase-01.png',
  './assets/phase-02.png',
  './assets/phase-03.png',
  './assets/phase-04.png',
  './assets/phase-05.png',
  './assets/phase-06.png',
  './assets/phase-07.png',
  './assets/phase-08.png',
  './assets/phase-09.png',
  './assets/phase-10.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
