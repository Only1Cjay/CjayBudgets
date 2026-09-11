/* ============================================================
   CjayBudgets — Service Worker
   ============================================================
   ⚠️ IMPORTANT: Bump CACHE_VERSION whenever you push changes
   to index.html, styles.css, or app.js.
   Otherwise users may keep seeing the cached version.

   Current version: v1.0.0
   ============================================================ */

const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = 'cjaybudgets-' + CACHE_VERSION;

// App files — stale-while-revalidate
const APP_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json'
];

// External assets — cache-first (fonts, icons)
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css'
];

/* ============================================================
   INSTALL — pre-cache shell + external assets
   ============================================================ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_ASSETS).catch(() => {});
      // External assets may fail (offline, blocked) — don't break install
      await Promise.all(
        EXTERNAL_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
      return self.skipWaiting();
    })
  );
});

/* ============================================================
   ACTIVATE — clean old caches, take control
   ============================================================ */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith('cjaybudgets-') && k !== CACHE_NAME)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ============================================================
   FETCH — strategy by request type
   ============================================================ */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only GET requests
  if(req.method !== 'GET') return;

  // 1. Google APIs (Drive sync, OAuth) — network only, never cache
  if(url.hostname.includes('googleapis.com') ||
     url.hostname.includes('accounts.google.com') ||
     url.hostname.includes('apis.google.com') ||
     url.hostname.includes('gstatic.com')){
    return; // let browser handle it
  }

  // 2. Fonts / icons CDN — cache-first
  if(url.hostname.includes('fonts.googleapis.com') ||
     url.hostname.includes('fonts.gstatic.com') ||
     url.hostname.includes('cdnjs.cloudflare.com')){
    event.respondWith(cacheFirst(req));
    return;
  }

  // 3. Same-origin app files — stale-while-revalidate
  if(url.origin === self.location.origin){
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 4. Everything else — network with cache fallback
  event.respondWith(networkWithCacheFallback(req));
});

/* ============================================================
   STRATEGIES
   ============================================================ */
async function cacheFirst(req){
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if(cached) return cached;
  try{
    const fresh = await fetch(req);
    if(fresh && fresh.status === 200) cache.put(req, fresh.clone());
    return fresh;
  }catch(e){
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(req){
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req).then(fresh => {
    if(fresh && fresh.status === 200){
      cache.put(req, fresh.clone());
      // Notify clients that a fresh version is available
      notifyUpdate(fresh.headers.get('etag') || Date.now().toString());
    }
    return fresh;
  }).catch(() => cached);

  return cached || fetchPromise;
}

async function networkWithCacheFallback(req){
  try{
    const fresh = await fetch(req);
    if(fresh && fresh.status === 200){
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
    }
    return fresh;
  }catch(e){
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    return cached || Response.error();
  }
}

/* ============================================================
   UPDATE NOTIFICATION
   ============================================================ */
async function notifyUpdate(version){
  const clients = await self.clients.matchAll({type:'window'});
  clients.forEach(c => c.postMessage({
    type: 'UPDATE_AVAILABLE',
    version: version
  }));
}

/* ============================================================
   MESSAGE HANDLING — from page
   ============================================================ */
self.addEventListener('message', (event) => {
  if(event.data && event.data.type === 'SKIP_WAITING'){
    self.skipWaiting();
  }
});
