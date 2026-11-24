/*
  Ruhepol – Service Worker (Offline-Kopie)

  Was er tut:
    - Beim Einrichten legt er alle Dateien der App im Gerät ab.
    - Danach beantwortet er jede Anfrage aus dieser Ablage ("Cache zuerst").
      So öffnet Ruhepol auch im Flugmodus.
    - Fremde Adressen beantwortet er nicht – Ruhepol fragt keine an.
  Wird eine Datei geändert: VERSION hochzählen (und BUILD in js/app.js),
  dann wird die Ablage erneuert und die alte gelöscht.

  Neue Version (Befund Codex Runde 2, Nr. 2):
    Sie wird im Hintergrund vollständig abgelegt und wartet dann. Übernommen wird
    sie erst, wenn die App „uebernehmen“ schickt – das tut sie nur beim Öffnen, bevor
    jemand tippt (Codex Runde 3). Danach lädt die App einmal neu – aber nie, wenn schon
    getippt wurde; dann gilt die neue Version ab dem nächsten Öffnen.
*/
"use strict";

// Präfix schützt Ablagen anderer Seiten derselben Adresse (z. B. des Technik-Tests).
const PRAEFIX = "ruhepol-";
const VERSION = `${PRAEFIX}s3-v2`;
// Liegt erst in der Ablage, wenn alle Dateien drin sind – die App liest daran „startklar“ ab.
const MARKE = "./offline-bereit";
const DATEIEN = [
  "./",
  "./index.html",
  "./css/ruhepol.css",
  "./js/farbwelt-frueh.js",
  "./js/app.js",
  "./js/akut.js",
  "./js/ton.js",
  "./schrift/Manrope-Variable.ttf",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const ablage = await caches.open(VERSION);
      // cache: "reload" = frisch vom Server, nicht aus dem Zwischenspeicher des Browsers.
      // Scheitert eine Datei, scheitert alles – dann gibt es auch keine Marke.
      await ablage.addAll(DATEIEN.map((d) => new Request(d, { cache: "reload" })));
      await ablage.put(MARKE, new Response("bereit", { headers: { "Content-Type": "text/plain" } }));
    })(),
  );
});

// Die App gibt das Zeichen, wenn ein ruhiger Moment ist. Nur Nachrichten der eigenen Seiten.
self.addEventListener("message", (event) => {
  if (event.data === "uebernehmen" && event.source?.url?.startsWith(self.registration.scope)) {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(PRAEFIX) && name !== VERSION) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const anfrage = event.request;
  // Nur eigene Dateien und nur Lesen. Alles andere geht unverändert durch.
  if (anfrage.method !== "GET" || new URL(anfrage.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const ablage = await caches.open(VERSION);
      // Aufruf der App selbst (auch mit #… oder ?…): immer die abgelegte Startseite.
      if (anfrage.mode === "navigate") {
        return (await ablage.match("./index.html")) ?? fetch(anfrage);
      }
      const treffer = await ablage.match(anfrage, { ignoreSearch: true });
      return treffer ?? fetch(anfrage);
    })(),
  );
});
