// Service worker: simpan fail aplikasi supaya boleh dibuka luar talian.
// Model AI disimpan sendiri oleh transformers.js (Cache Storage "transformers-cache").
const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const RUNTIME = 'runtime-v1';
const ASSETS = [
  './', 'index.html', 'css/styles.css', 'js/app.js', 'js/align.js', 'js/recorder.js', 'js/asr-worker.js',
  'data/juz30.json', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fail aplikasi: rangkaian dahulu (supaya kemas kini cepat sampai), cache jika luar talian
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
    );
    return;
  }
  // Pustaka AI (jsDelivr) & fon (Google Fonts): cache dahulu
  if (/cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.host)) {
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
  }
});
