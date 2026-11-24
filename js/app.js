/*
  Ruhepol – Steuerung der App (Bauschritte 2 und 3)

  Was diese Datei tut:
    1. Ansichten:   zeigt Start, Akuthilfe, Einstellungen oder Hilfe – je nach #… in der Adresse.
                    Der große Knopf startet die Akuthilfe sofort (Ablauf: js/akut.js).
                    Wer die Akuthilfe verlässt (Hilfe, Zurück-Geste), beendet sie sanft.
    2. Farbwelt:    Nachtblau (Standard), Sand, Waldgrün; die Wahl bleibt im Gerät gespeichert.
    3. Speicher:    bittet das System um dauerhaften Speicher (navigator.storage.persist).
                    Im iPhone-Test (Schritt 1) wurde er noch nicht gewährt. Safari entscheidet
                    selbst, ohne Rückfrage, nach Nutzung der App – darum fragt Ruhepol bei
                    jedem Start und nach der ersten Bedienung erneut, bis er gewährt ist.
                    Der Kasten „Speicher“ zeigt getrennt: Konnte Ruhepol speichern? Hat das
                    Gerät die dauerhafte Zusage gegeben?
    4. Offline:     richtet die Offline-Kopie ein (sw.js). „Startet sofort. Auch ohne Internet.“ steht erst
                    da, wenn die Kopie vollständig im Gerät liegt und die Seite steuert.
                    Neue Versionen werden nur beim Öffnen übernommen, bevor jemand tippt –
                    nie während der Benutzung (siehe Abschnitt 4).
    5. Hilfe-Knopf: Platz unter dem Inhalt richtet sich nach seiner echten Höhe
                    (große Schrift → Knopf bricht um → mehr Platz, nichts wird verdeckt).

  Ton: Vor jedem Abspielen  navigator.audioSession.type = "playback"  (Ergebnis iPhone-Test
  Bauschritt 1) – das erledigt js/ton.js.

  Feste Regeln: keine Verbindung nach außen, Text nur über textContent (nie innerHTML).
*/
import * as akut from "./akut.js";

// Muss zu VERSION in sw.js passen. Hochzählen, wenn sich eine Datei ändert.
const BUILD = "s3-v2";

const ANSICHTEN = ["start", "akut", "einstellungen", "hilfe"];
const FARBWELTEN = {
  nachtblau: { name: "Ruhiges Nachtblau", statusleiste: "#0D1522" },
  sand: { name: "Warme Sandtöne", statusleiste: "#F7F0E4" },
  wald: { name: "Gedecktes Waldgrün", statusleiste: "#12201A" },
};
const SCHLUESSEL_FARBWELT = "ruhepol-farbwelt";
// Diese Markierung legt sw.js erst ab, wenn ALLE Dateien in der Offline-Kopie liegen.
const OFFLINE_MARKE = "./offline-bereit";

const $ = (sel) => document.querySelector(sel);

/* ---------------- 1. Ansichten ---------------- */

/** Zeigt die Ansicht aus der Adresse (#start, #einstellungen, #hilfe). */
function zeigeAnsicht({ fokus }) {
  const gewuenscht = location.hash.replace("#", "");
  let name = ANSICHTEN.includes(gewuenscht) ? gewuenscht : "start";

  // Akuthilfe nur über den großen Knopf. Wer per Zurück/Vor oder Neuladen auf #akut landet,
  // ohne dass ein Ablauf läuft, kommt zum Start (dort ist der Knopf).
  if (name === "akut" && document.documentElement.dataset.ablauf !== "laeuft") {
    history.replaceState(null, "", "#start");
    name = "start";
  }
  if (name !== "akut") akut.verlasse();

  for (const el of document.querySelectorAll("[data-ansicht]")) {
    el.hidden = el.dataset.ansicht !== name;
    el.classList.toggle("wechsel", fokus); // Einblenden nur bei Wechsel, nicht beim Öffnen
  }
  window.scrollTo(0, 0);

  // Für Vorlesen (VoiceOver): nach einem Wechsel die Überschrift ansagen.
  if (fokus) $(`#${name} h1`)?.focus({ preventScroll: true });

  if (name === "einstellungen") {
    zeigeFarbwahl();
    pruefeSpeicher();
  }
}

/** Hilfe-Knopf auf der Hilfe-Ansicht selbst: zurück nach oben zu den Rufnummern. */
function hilfeKnopfGetippt(ereignis) {
  if (location.hash !== "#hilfe") return; // normaler Wechsel zur Hilfe
  ereignis.preventDefault();
  window.scrollTo(0, 0);
  $("#hilfe-titel").focus({ preventScroll: true });
}

/** Der große Knopf: Ablauf sofort starten – im selben Tipp, damit iOS den Ton freigibt. */
function ruheKnopfGetippt() {
  if (akut.laeuft()) return; // zweites schnelles Tippen startet nicht neu (Befund Codex Runde 3, Nr. 8)
  akut.starte();
  location.hash = "#akut";
}

/* ---------------- 2. Farbwelt ---------------- */

function aktuelleFarbwelt() {
  const wert = document.documentElement.dataset.farbwelt;
  return Object.hasOwn(FARBWELTEN, wert) ? wert : "nachtblau";
}

function setzeFarbwelt(wert) {
  if (!Object.hasOwn(FARBWELTEN, wert)) return; // nur bekannte Werte
  document.documentElement.dataset.farbwelt = wert;
  $('meta[name="theme-color"]')?.setAttribute("content", FARBWELTEN[wert].statusleiste);
  try {
    localStorage.setItem(SCHLUESSEL_FARBWELT, wert);
    speicher.ablageOk = true;
  } catch {
    speicher.ablageOk = false; // Farbwelt gilt dann nur bis zum Schließen
  }
  zeigeSpeicher();
}

function zeigeFarbwahl() {
  const aktiv = aktuelleFarbwelt();
  for (const feld of document.querySelectorAll('input[name="farbwelt"]')) {
    feld.checked = feld.value === aktiv;
  }
}

/* ---------------- 3. Speicher ---------------- */

const speicher = {
  ablageOk: true,        // konnte Ruhepol zuletzt etwas ablegen?
  zusage: "pruefung",    // "pruefung" | "dauerhaft" | "offen" | "unbekannt" | "nicht-verfuegbar"
  laeuft: false,         // läuft gerade eine Anfrage?
  nochmal: false,        // während der Anfrage kam ein weiterer Anlass (z. B. erstes Tippen)
};

/** Prüft beim Start, ob überhaupt etwas abgelegt werden kann (privater Modus, gesperrt …). */
function pruefeAblage() {
  try {
    localStorage.setItem("ruhepol-probe", "1");
    localStorage.removeItem("ruhepol-probe");
    speicher.ablageOk = true;
  } catch {
    speicher.ablageOk = false;
  }
}

/**
 * Fragt beim Gerät nach der dauerhaften Zusage und bittet sonst erneut darum.
 * Kommt während einer laufenden Anfrage ein neuer Anlass, wird danach noch einmal
 * gefragt – das erste Tippen geht so nicht verloren.
 */
async function pruefeSpeicher() {
  if (!navigator.storage?.persisted) {
    speicher.zusage = "nicht-verfuegbar";
    zeigeSpeicher();
    return;
  }
  if (speicher.laeuft) {
    speicher.nochmal = true;
    return;
  }
  speicher.laeuft = true;
  try {
    let dauerhaft = await navigator.storage.persisted();
    if (!dauerhaft && navigator.storage.persist) dauerhaft = await navigator.storage.persist();
    speicher.zusage = dauerhaft ? "dauerhaft" : "offen";
  } catch {
    speicher.zusage = "unbekannt";
  } finally {
    speicher.laeuft = false;
    zeigeSpeicher();
    if (speicher.nochmal) {
      speicher.nochmal = false;
      if (speicher.zusage !== "dauerhaft") pruefeSpeicher();
    }
  }
}

/**
 * Schreibt den echten Zustand in den Kasten „Speicher“. Ruhig, ohne Alarm.
 * Reihenfolge: Erst ob Speichern überhaupt klappt, dann die Zusage des Geräts.
 */
function zeigeSpeicher() {
  const texte = {
    "ablage-fehler": [
      "Speichern gerade nicht möglich",
      "Deine Wahl gilt, bis du Ruhepol schließt. Beim nächsten Start versucht Ruhepol es erneut.",
    ],
    dauerhaft: [
      "Dauerhaft gesichert",
      "Deine Daten sind auf diesem Gerät gespeichert. Das Gerät hat zugesagt, sie nicht von selbst zu löschen.",
    ],
    offen: [
      "Auf diesem Gerät gespeichert",
      "Die dauerhafte Zusage des Geräts steht noch aus. Ruhepol fragt beim nächsten Start erneut danach.",
    ],
    unbekannt: [
      "Auf diesem Gerät gespeichert",
      "Ob das Gerät die dauerhafte Zusage gibt, ließ sich gerade nicht abfragen. Ruhepol fragt beim nächsten Start erneut.",
    ],
    "nicht-verfuegbar": [
      "Auf diesem Gerät gespeichert",
      "Dieses Gerät gibt keine dauerhafte Zusage. Später kannst du alles zusätzlich als Datei sichern.",
    ],
    pruefung: ["Wird geprüft …", ""],
  };
  const zustand = speicher.ablageOk ? speicher.zusage : "ablage-fehler";
  const [titel, hinweis] = texte[zustand];
  $("#speicher-status").textContent = titel;
  $("#speicher-hinweis").textContent = hinweis;
  $("#speicher-kasten").dataset.zustand = zustand;
}

/** Erste echte Bedienung (Tippen, Tastatur, VoiceOver) – danach erneut um die Zusage bitten. */
function beobachteErsteBedienung() {
  const arten = ["pointerdown", "keydown", "click"];
  const einmal = () => {
    for (const art of arten) document.removeEventListener(art, einmal, true);
    pruefeSpeicher();
  };
  for (const art of arten) document.addEventListener(art, einmal, true);
}

/* ---------------- 4. Offline-Kopie ---------------- */

/** Liegt eine vollständige Offline-Kopie vor, und steuert sie diese Seite? */
async function offlineBereit() {
  if (!navigator.serviceWorker?.controller) return false;
  try {
    return Boolean(await caches.match(OFFLINE_MARKE));
  } catch {
    return false;
  }
}

async function zeigeOfflineStatus() {
  const el = $("#offline-status");
  if (!("serviceWorker" in navigator)) {
    el.textContent = "Dieses Gerät kann keine Offline-Kopie anlegen. Ruhepol braucht hier Internet.";
    el.dataset.zustand = "nicht-moeglich";
  } else if (await offlineBereit()) {
    el.textContent = "Startet sofort. Auch ohne Internet.";
    el.dataset.zustand = "bereit";
  } else {
    el.textContent = "Die Offline-Kopie wird vorbereitet. Lass Ruhepol dafür einmal kurz mit Internet geöffnet.";
    el.dataset.zustand = "vorbereitung";
  }
}

/*
  Neue Versionen (Befund Codex Runde 3, Nr. 1 und 2):
    - Übernommen wird nur beim Öffnen der App, solange noch niemand etwas angetippt hat.
    - Kommt der Wechsel trotzdem erst nach der ersten Bedienung an, lädt die Seite NICHT neu.
      Sie hat alle ihre Dateien schon geladen und läuft unverändert weiter; die neue Version
      gilt ab dem nächsten Öffnen. So kann ein Update nie eine laufende Akuthilfe unterbrechen –
      auch nicht, wenn ein zweites Fenster der App das Update freigibt.
    - Während die App offen ist, wird nach Updates gesucht und vollständig abgelegt.
*/
let bedient = false;

function merkeBedienung() {
  const arten = ["pointerdown", "keydown"];
  const einmal = () => {
    bedient = true;
    for (const art of arten) document.removeEventListener(art, einmal, true);
  };
  for (const art of arten) document.addEventListener(art, einmal, true);
}

/** Beim Öffnen: Wartet eine neue Version und hat noch niemand getippt, jetzt übernehmen. */
function uebernimmBeimOeffnen(reg) {
  if (!bedient && reg.waiting && navigator.serviceWorker.controller) {
    reg.waiting.postMessage("uebernehmen");
  }
}

async function richteOfflineKopieEin() {
  if (!("serviceWorker" in navigator)) {
    zeigeOfflineStatus();
    return;
  }
  merkeBedienung();
  const hatteSteuerung = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hatteSteuerung) {
      zeigeOfflineStatus(); // erste Einrichtung fertig: nichts neu laden
      return;
    }
    // Schutz direkt vor dem Neuladen: nie, wenn schon getippt wurde oder ein Ablauf läuft.
    if (bedient || document.documentElement.dataset.ablauf === "laeuft") return;
    try {
      if (sessionStorage.getItem("ruhepol-neu-geladen") === BUILD) return; // Schleifenschutz
      sessionStorage.setItem("ruhepol-neu-geladen", BUILD);
    } catch {
      // Ohne sessionStorage trotzdem einmal neu laden – danach steuert die neue Version.
    }
    location.reload();
  });

  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    reg.addEventListener("updatefound", () => {
      const neu = reg.installing;
      neu?.addEventListener("statechange", () => {
        if (neu.state === "activated") zeigeOfflineStatus();
      });
    });
    uebernimmBeimOeffnen(reg);
    reg.update().catch(() => {}); // ohne Internet schlägt das still fehl – gewollt
  } catch {
    // Ohne Offline-Kopie läuft die App trotzdem; beim nächsten Start wird es erneut versucht.
  }
  zeigeOfflineStatus();
}

/* ---------------- 5. Platz für den Hilfe-Knopf ---------------- */

function beobachteHilfeKnopf() {
  const knopf = $("#hilfe-pill");
  const setze = () =>
    document.documentElement.style.setProperty(
      "--hilfe-hoehe",
      `${Math.ceil(knopf.getBoundingClientRect().height)}px`,
    );
  setze();
  if ("ResizeObserver" in window) new ResizeObserver(setze).observe(knopf);
}

/* ---------------- Start ---------------- */

function start() {
  $("#version-zeile").textContent = `Ruhepol · Bauschritt 3 · ${BUILD}`;

  akut.richteEin();
  $("#ruhe-knopf").addEventListener("click", ruheKnopfGetippt);

  for (const feld of document.querySelectorAll('input[name="farbwelt"]')) {
    feld.addEventListener("change", () => {
      if (feld.checked) setzeFarbwelt(feld.value);
    });
  }
  $("#hilfe-pill").addEventListener("click", hilfeKnopfGetippt);

  beobachteHilfeKnopf();
  window.addEventListener("hashchange", () => zeigeAnsicht({ fokus: true }));
  zeigeAnsicht({ fokus: false });

  // Speicher: beim Öffnen und nach der ersten Bedienung erneut um die Zusage bitten
  // (Safari wertet echte Nutzung aus).
  pruefeAblage();
  pruefeSpeicher();
  beobachteErsteBedienung();

  richteOfflineKopieEin();
}

start();
