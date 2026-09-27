// sw.js: the "service worker".
// A small helper script that the phone keeps next to our app.
// Its job for now: keep a copy of the app's files, so the app still opens without internet.
//
// Strategy "network first":
//   1. Always try to get the newest file from the internet (so updates show up right away).
//   2. Save a copy of it.
//   3. Only if there's no internet, use the saved copy.

// Name of the storage box for saved files. Changing the name starts a fresh box.
const CACHE_NAME = "mypodcasts-v1";

// When a new version of this file arrives, start using it immediately
// instead of waiting until every app window is closed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Every time the app asks for a file, this runs.
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle simple "give me this file" requests...
  if (request.method !== "GET") return;
  // ...and only for our own files. Podcast audio and directory searches
  // come from other websites, and we leave those alone.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Got it from the internet. Save a copy if it's a good answer.
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        // No internet: use the saved copy. If we don't have that exact file,
        // fall back to the saved main page.
        caches.match(request).then((saved) => saved || caches.match("./"))
      )
  );
});
