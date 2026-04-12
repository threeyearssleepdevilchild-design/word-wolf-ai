const CACHE_NAME = 'word-wolf-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles/main.css',
    './scripts/app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// インストール時にキャッシュ（即座にアクティブ化）
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

// アクティブ化時に古いキャッシュを削除
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// ネットワーク優先、失敗時にキャッシュ（常に最新を取得）
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // 成功したらキャッシュを更新
                if (response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // オフライン時はキャッシュから
                return caches.match(event.request);
            })
    );
});
