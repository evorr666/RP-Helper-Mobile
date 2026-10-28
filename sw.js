const CACHE = 'rp-helper-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/app.js',
  './js/parser.js',
  './js/api.js',
  './data/codes.json',
  './data/facts.json',
  './data/faq.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Кодексы с GitHub — кэш первый
  if (url.host === 'raw.githubusercontent.com') {
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const cached = await c.match(e.request);
        if (cached) return cached;
        try {
          const r = await fetch(e.request);
          if (r.ok) c.put(e.request, r.clone());
          return r;
        } catch {
          return new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // Google API — сеть первый
  if (url.host === 'script.google.com') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Остальное — кэш первый
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});