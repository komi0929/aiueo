// Service Worker — PWA オフラインキャッシュ + ITP回避
const CACHE_NAME = 'mamimume-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/src/main.js',
  '/src/style.css',
  '/src/stroke-engine.js',
  '/src/guide-renderer.js',
  '/src/feedback.js',
  '/src/hiragana-data.js',
  '/favicon.svg',
];

// インストール: 主要アセットをキャッシュ
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// アクティベーション: 古いキャッシュを削除
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ: ネットワーク優先、失敗時キャッシュ
self.addEventListener('fetch', (e) => {
  // Google Fonts等の外部リクエストはスルー
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
