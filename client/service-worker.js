const CACHE_NAME = 'word-wolf-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles/main.css',
    './scripts/app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// インストール時にキャッシュ
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
});

// リクエスト時にキャッシュから応答
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => response || fetch(event.request))
    );
});
