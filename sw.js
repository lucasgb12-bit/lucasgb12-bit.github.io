// Lets the installed web app open without internet.
// - Pages: network first, so a new release shows on the next open; saved copy when offline.
// - Build files (/_expo/static/) have unique names per release, so a saved copy is always correct.
// - The app is saved during install, and older saved copies are only deleted once the new one
//   is complete, so there is always something to open offline.
// - If nothing at all is saved, a short offline page is shown instead of a browser error.
const CACHE_NAME = 'optiv-v3';

const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Optiv</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;
justify-content:center;background:#111;color:#eee;font:16px -apple-system,system-ui,sans-serif;
text-align:center;padding:24px;box-sizing:border-box}h1{color:#ae8625;font-size:20px;letter-spacing:2px}
button{margin-top:16px;padding:12px 20px;border:0;border-radius:10px;background:#ae8625;color:#111;
font-weight:700;font-size:15px}</style></head><body><div><h1>OPTIV</h1>
<p>Optiv needs an internet connection once to finish updating.<br>Connect and try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

/** Saves the start page and every build file it references. */
async function saveApp() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch('/', { cache: 'no-store' });
  if (!response.ok) throw new Error('start page unavailable');
  const html = await response.clone().text();
  const assets = [...new Set(html.match(/\/_expo\/static\/[^"'\s)]+/g) ?? [])];
  await Promise.all(assets.map((url) => cache.add(url)));
  await cache.put('/', response);
}

self.addEventListener('install', (event) => {
  // If saving fails (e.g. offline), install still succeeds; saving is retried on the next page load.
  event.waitUntil(saveApp().catch(() => undefined).then(() => self.skipWaiting()));
});

async function deleteOldCachesIfReady() {
  const cache = await caches.open(CACHE_NAME);
  if (!(await cache.match('/'))) return; // keep older copies until this one is usable
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteOldCachesIfReady().then(() => self.clients.claim()));
});

function offlinePage() {
  return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function networkFirst(cache, request) {
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      await cache.put(request, response.clone());
      if (request.mode === 'navigate') deleteOldCachesIfReady();
    }
    return response;
  } catch (error) {
    // Search every saved copy (including an older release) before giving up.
    const saved = (await caches.match(request)) || (request.mode === 'navigate' ? await caches.match('/') : undefined);
    if (saved) return saved;
    if (request.mode === 'navigate') return offlinePage();
    throw error;
  }
}

async function cacheFirst(cache, request) {
  const saved = await caches.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      url.pathname.startsWith('/_expo/static/') ? cacheFirst(cache, request) : networkFirst(cache, request),
    ),
  );
});
