const CACHE = "amid-shell-v262";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/manifest.webmanifest", "/backgrounds/amid-main.jpg", "/assets/fonts/TerrarumSansBitmap.otf", "/assets/plain-theme/sleeping-cats.png", "/assets/plain-theme/hero-chase.jpg", "/assets/plain-theme/hero-bag.jpg", "/assets/plain-theme/hero-donut-cutout.webp", "/assets/plain-theme/diary-settings-sprite.png", "/assets/plain-theme/diary-icon.png", "/assets/plain-theme/calendar-icon.png", "/assets/plain-theme/chat-icon.png", "/assets/pwa-home/icon-192.png", "/assets/pwa-home/icon-512.png", "/assets/action-icons/copy.png", "/assets/action-icons/reply.png", "/assets/action-icons/transcript.png", "/assets/action-icons/select.png", "/assets/action-icons/favorite.png", "/assets/action-icons/favorite-outline.png", "/assets/action-icons/delete.png", "/assets/action-icons/voice.png", "/assets/action-icons/regenerate.png", "/assets/action-icons/forward.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.url.includes("/api/")) return;
  const url = new URL(event.request.url);
  const appShellRequest = event.request.mode === "navigate" || ["/", "/index.html", "/app.js", "/styles.css", "/manifest.webmanifest"].includes(url.pathname);
  if (appShellRequest) {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/index.html"))));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
