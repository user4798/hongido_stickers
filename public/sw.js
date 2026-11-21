// sw.js — 서비스 워커: 앱 파일을 기기에 보관해 두고, 인터넷이 없거나 느려도 앱이 열리게 한다.
// 방식: 먼저 인터넷에서 새 파일을 받아 보고(3초까지), 안 되면 보관해 둔 파일을 쓴다.
//       그래서 배포하면 다음에 열 때 새 버전이 바로 보이고, 오프라인에서는 마지막 버전이 열린다.
// 사진은 여기서 다루지 않는다 (사진은 기기 안 IndexedDB에만 있다).

importScripts('config.js');
const CACHE = `hongido-app-${APP.version}`;   // 버전이 바뀌면 예전 보관 파일은 지운다
const CORE = [
  './', 'index.html', 'style.css', 'config.js', 'icons.js', 'pdfwriter.js', 'calibration.js',
  'filters.js', 'photo.js', 'photo-worker.js', 'editor.js', 'store.js', 'app.js',
  'test.html', 'test.js', 'hongido-face.png', 'icon-180.png', 'icon-512.png', 'favicon-64.png', 'favicon-192.png', 'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 3000);
    fetch(request).then((res) => {
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      resolve(res);
    }, (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fromNetwork(req).catch(() => caches.match(req, { ignoreSearch: true })
      .then((hit) => hit || caches.match('index.html'))),
  );
});
