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
const CACHE = PREFIX + "0-22-1-built-2026-10-23-06-06";
// The dictionary and the Ear trainer's sentence list are large and change
// rarely. Their file names carry a hash of their content, so they live in a
// cache of their own that survives app updates; only a replaced file is dropped.
const DATA = PREFIX + "data";
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
    const old = keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE && k !== DATA);
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
  // the version check must always reach the network, never a saved copy
  if (url.pathname.endsWith("/version.json")) return;

  if (request.mode === "navigate") {
    // The page on this device opens at once, with no wait for the network.
    // A fresh copy is fetched behind it (no-store skips the ten minute copy
    // GitHub Pages asks browsers to keep) and saved for next time. A new
    // version also arrives with a new worker, which reloads the open page.
    const isMain = url.pathname === BASE || url.pathname === BASE + "index.html";
    const fresh = fetch(request.url, { cache: "no-store" }).then((response) => {
      if (response.ok && isMain) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put("./", copy));
      }
      return response;
    });
    event.respondWith((async () => {
      const saved = isMain ? await caches.match("./") : undefined;
      if (saved) {
        event.waitUntil(fresh.catch(() => {}));
        return saved;
      }
      try {
        return await fresh;
      } catch {
        return (await caches.match("./")) || Response.error();
      }
    })());
    return;
  }

  if (/\/(dict|ear)\/[^/]+\.json$/.test(url.pathname)) {
    event.respondWith((async () => {
      const data = await caches.open(DATA);
      const hit = (await data.match(request)) || (await caches.match(request));
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) {
        // saved behind the page, so a download's progress still shows as it arrives
        const copy = response.clone();
        event.waitUntil((async () => {
          const folder = url.pathname.replace(/[^/]*$/, "");
          for (const k of await data.keys()) {
            const p = new URL(k.url).pathname;
            if (p.startsWith(folder) && p !== url.pathname) await data.delete(k);
          }
          await data.put(request, copy);
        })());
      }
      return response;
    })());
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
