/*
 * Offline support for Saphal French.
 *
 * The whole app lives inside index.html, so caching that page, the manifest
 * and the icons is enough to make it work with no connection.
 *
 * This account hosts other projects on the same address: the root site,
 * /nepal-fs-compiler/ and /saphal-book/. This worker is registered with the
 * scope /saphal-french/ and also refuses to touch any request outside that
 * folder, and it only ever deletes caches whose names start with its own
 * prefix. That way it can never overwrite another project's offline copy.
 */
const PREFIX = "saphal-french-";
const CACHE = PREFIX + "0-12-0-built-2026-10-20-07-51";
const BASE = new URL("./", self.location).pathname;
const SHELL = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

function ownsPath(pathname) {
  return pathname.startsWith(BASE);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "no-store" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    // Only an update reloads open pages. A first install has nothing older to replace.
    if (old.length) {
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => c.postMessage({ type: "sf-updated" }));
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !ownsPath(url.pathname)) return;

  if (request.mode === "navigate") {
    // GitHub Pages tells browsers to keep pages for ten minutes. no-store skips
    // that copy so a new version shows the moment it is published.
    event.respondWith(
      fetch(request.url, { cache: "no-store" })
        .then((response) => {
          if (response.ok && (url.pathname === BASE || url.pathname === BASE + "index.html")) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("./", copy));
          }
          return response;
        })
        .catch(() => caches.match("./").then((hit) => hit || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok && !url.pathname.endsWith(".html")) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
