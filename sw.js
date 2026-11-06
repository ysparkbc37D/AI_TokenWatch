/**
 * AI 토큰 관제 PWA Service Worker (sw.js)
 * 오프라인 캐싱 & 원격 PWA 지원
 */
const CACHE_NAME = 'llm-token-vault-v1';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './gemini.html',
  './claude.html',
  './chatgpt.html',
  './dashboard.css',
  './js/viz.js',
  './js/analysis.js',
  './js/dashboard.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// 설치 단계: 핵심 정적 애셋 사전 캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 활성화 단계: 이전 버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 요청 처리: API/데이터는 Network-First (오프라인 시 캐시), 정적 파일은 Stale-While-Revalidate
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // POST 요청은 캐시하지 않고 직접 전달
  if (req.method !== 'GET') return;

  // 1. API 요청 및 데이터 JSON: Network First -> 실패 시 Cache 반환
  if (url.pathname.includes('/api/') || url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => {
        return caches.match(req);
      })
    );
    return;
  }

  // 2. 정적 애셋 (HTML, CSS, JS, 이미지): Stale While Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
