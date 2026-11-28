/* =====================================================================
   sw.js – Service worker của UPMD: cho phép mở ứng dụng khi không có mạng.
   - Trang và mã của ứng dụng: lấy bản mới trên mạng trước, mất mạng thì dùng bản đã lưu.
   - Thư viện từ CDN (marked, DOMPurify, highlight.js, KaTeX, Mermaid) và phông chữ: có địa chỉ
     cố định theo phiên bản, nên lấy bản đã lưu trước cho nhanh.
   - Mọi thứ khác (tệp mở từ link, Google Drive, đăng nhập Google…) đi thẳng ra mạng, không lưu.
   Đổi VER khi cần xóa bộ nhớ đệm cũ.
   ===================================================================== */
var VER = 'upmd-v1';
var SHELL = ['./', './app.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
var CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js'
];
var CACHE_FIRST = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VER).then(function (c) {
    // lưu từng tệp riêng: một tệp lỗi không làm hỏng cả lần cài
    return Promise.all(SHELL.concat(CDN).map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VER; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function putCache(req, res) {
  if (res && (res.ok || res.type === 'opaque') && !res.redirected) {
    var copy = res.clone();
    caches.open(VER).then(function (c) { c.put(req, copy); });
  }
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // trang chính: mạng trước, mất mạng thì dùng bản đã lưu
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) { return putCache('./', res); })
      .catch(function () { return caches.match('./'); }));
    return;
  }

  // tệp của chính ứng dụng
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(function (res) { return putCache(req, res); })
      .catch(function () { return caches.match(req, { ignoreSearch: true }); }));
    return;
  }

  // thư viện CDN và phông chữ: bản đã lưu trước
  if (CACHE_FIRST.test(req.url)) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { return putCache(req, res); });
    }));
  }
  // còn lại: để trình duyệt tự xử lý (không lưu)
});
