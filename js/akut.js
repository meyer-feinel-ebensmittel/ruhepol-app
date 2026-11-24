/*
  Ruhepol – Akuthilfe-Ablauf (Bauschritt 3)

  Ein Tippen auf „Ich brauche jetzt Ruhe“ startet sofort, ohne jede Auswahl:
    1. Ankommen   20 s
    2. Atmen      2 min   Atemkreis im Takt 4 s ein / 6 s aus (Standard „Ruhig 4–6“)
    3. Erden      1 min   5-4-3-2-1: sehen, hören, spüren, riechen, schmecken (je 12 s)
    4. Halten     so lange du magst (Atemkreis läuft weiter)
    5. Abschluss  eine Frage, drei Knöpfe
  „Sanft beenden“ führt jederzeit zum Abschluss. Der Hilfe-Knopf bleibt immer sichtbar.

  Unterbrechungen (Befund Codex Runde 3, Nr. 3):
    Geht die App in den Hintergrund (Sperrtaste, anderer App, Anruf), pausiert der Ablauf.
    Beim Zurückkommen geht es an derselben Stelle weiter, mit einem neuen Atemzug.

  Feste Regeln:
    - Keine frei formulierende KI: Alle Sätze stehen fest in dieser Datei.
    - Kein Heilungs- oder Behandlungsversprechen in den Sätzen.
    - Kein langes Luftanhalten (Standard-Rhythmus ohne Halten).
  Später (Bauschritte 4–6): Stimme, Klänge, Dauer und Rhythmus aus dem Koffer.
*/

import * as ton from "./ton.js";

const PHASEN = [
  {
    name: "ankommen",
    wort: "Ankommen",
    dauer: 20,
    satz: "Du musst gerade nichts leisten. Spür, wie deine Füße den Boden berühren.",
  },
  {
    name: "atmen",
    wort: "Atmen",
    dauer: 120,
    satz: "Atme mit dem Kreis. Das Ausatmen darf länger sein als das Einatmen.",
  },
  {
    name: "erden",
    wort: "Erden",
    dauer: 60,
    satz: "Schau dich in Ruhe um und zähl leise mit. Wenn dir nichts einfällt, lass es einfach aus.",
  },
  {
    name: "halten",
    wort: "Halten",
    dauer: Infinity,
    satz: "Bleib hier, so lange du magst. Du kannst jederzeit sanft beenden.",
  },
];
const ABSCHLUSS = { wort: "Abschluss" };
const SCHRITTE = PHASEN.length + 1; // fünf Punkte

const ERDEN = [
  { zahl: "5", text: "Dinge, die du sehen kannst" },
  { zahl: "4", text: "Dinge, die du hören kannst" },
  { zahl: "3", text: "Dinge, die du spüren kannst" },
  { zahl: "2", text: "Dinge, die du riechen kannst" },
  { zahl: "1", text: "Sache, die du schmecken kannst" },
];
const TAKT_TEXT = "4 Sekunden ein · 6 Sekunden aus";

const $ = (sel) => document.querySelector(sel);
const wenigerBewegung = matchMedia("(prefers-reduced-motion: reduce)");

const zustand = {
  laeuft: false,      // Ablauf aktiv (Phasen 1–4)
  lauf: 0,            // Nummer des aktuellen Ablaufs (gegen verspätete Antworten)
  angesammelt: 0,     // ms Ablaufzeit vor der letzten Pause
  aktivSeit: 0,       // Zeitpunkt (ms), seit dem der Ablauf ohne Pause läuft
  pausiert: false,
  atemAnker: 0,       // Zeitpunkt (ms) eines Atemzug-Anfangs, falls der Ton nicht läuft
  versatz: 0,         // Sekunden, die übersprungen werden („Noch eine Runde“ beginnt bei Atmen)
  phase: -1,
  erdenSchritt: -1,
  atemWort: "",
  bild: 0,            // requestAnimationFrame-Nummer
  wachSperre: null,
  wachAnfrage: false,
};

/* ---------------- Bildschirm wach halten ---------------- */

/** Nur eine Anfrage zugleich. Kommt die Zusage erst nach dem Ende des Ablaufs, sofort zurückgeben. */
async function holeWachSperre() {
  if (!("wakeLock" in navigator) || zustand.wachSperre || zustand.wachAnfrage) return;
  const lauf = zustand.lauf;
  zustand.wachAnfrage = true;
  try {
    const sperre = await navigator.wakeLock.request("screen");
    if (!zustand.laeuft || zustand.lauf !== lauf || zustand.pausiert) {
      sperre.release().catch(() => {});
      return;
    }
    zustand.wachSperre = sperre;
    sperre.addEventListener("release", () => {
      if (zustand.wachSperre === sperre) zustand.wachSperre = null;
    });
  } catch {
    // z. B. Stromsparmodus: Ablauf läuft trotzdem
  } finally {
    zustand.wachAnfrage = false;
  }
}

function gibWachSperreFrei() {
  zustand.wachSperre?.release().catch(() => {});
  zustand.wachSperre = null;
}

/* ---------------- Anzeige und Ansagen ---------------- */

/** Für VoiceOver: kurze Ansage, ohne dass sich auf dem Bildschirm etwas verschiebt. */
function sage(wo, text) {
  $(wo).textContent = text;
}

function zeigePunkte(index) {
  document.querySelectorAll("#akut-punkte li").forEach((punkt, i) => {
    punkt.dataset.zustand = i < index ? "fertig" : i === index ? "aktiv" : "offen";
  });
  const wort = index < PHASEN.length ? PHASEN[index].wort : ABSCHLUSS.wort;
  $("#phase-wort").textContent = wort;
  return `Schritt ${index + 1} von ${SCHRITTE}: ${wort}.`;
}

function zeigePhase(index) {
  const phase = PHASEN[index];
  zustand.phase = index;
  zustand.erdenSchritt = -1;
  zustand.atemWort = "";
  const schritt = zeigePunkte(index);
  $("#akut-satz").textContent = phase.satz;
  $("#akut").dataset.phase = phase.name;
  sage("#phase-vorlesen", `${schritt} ${phase.satz}`);
  if (phase.name === "ankommen") {
    $("#atem-wort").textContent = "Du bist da.";
    $("#atem-takt").textContent = "Atme einfach mit, wenn du magst.";
  } else if (phase.name !== "erden") {
    $("#atem-takt").textContent = TAKT_TEXT;
  }
}

/** Weiche Kurve 0 → 1 (langsam los, langsam an). */
const weich = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1));

function zeigeAtem(t) {
  // t = Sekunden im 10-s-Zyklus. Einatmen 0–4 s: Kreis wächst, Ausatmen 4–10 s: Kreis wird kleiner.
  const einatmen = t < ton.EIN;
  const anteil = einatmen ? weich(t / ton.EIN) : 1 - weich((t - ton.EIN) / (ton.ZYKLUS - ton.EIN));
  const kreis = $("#atem-kreis");
  const phase = PHASEN[zustand.phase]?.name;
  if (wenigerBewegung.matches) {
    // Ohne Bewegung: feste Größe. Beim Atmen zeigt nur die Helligkeit den Takt, beim Erden ruht alles.
    kreis.style.transform = "scale(0.86)";
    kreis.style.opacity = phase === "erden" ? "0.75" : String(0.45 + 0.55 * anteil);
  } else {
    kreis.style.transform = `scale(${0.72 + 0.28 * anteil})`;
    kreis.style.opacity = "1";
  }
  if (phase === "atmen" || phase === "halten") {
    const wort = einatmen ? "Atme ein …" : "Atme aus …";
    if (wort !== zustand.atemWort) {
      zustand.atemWort = wort;
      $("#atem-wort").textContent = wort;
      sage("#takt-vorlesen", einatmen ? "Einatmen" : "Ausatmen");
    }
  }
}

function zeigeErden(sekundeInPhase) {
  const schritt = Math.min(Math.floor(sekundeInPhase / 12), ERDEN.length - 1);
  if (schritt === zustand.erdenSchritt) return;
  zustand.erdenSchritt = schritt;
  $("#atem-wort").textContent = ERDEN[schritt].zahl;
  $("#atem-takt").textContent = ERDEN[schritt].text;
  sage("#takt-vorlesen", `${ERDEN[schritt].zahl} ${ERDEN[schritt].text}`);
}

/* ---------------- Takt ---------------- */

function vergangeneSekunden() {
  const ms = zustand.angesammelt + (zustand.pausiert ? 0 : performance.now() - zustand.aktivSeit);
  return ms / 1000;
}

function phaseZu(sekunden) {
  let rest = sekunden;
  for (let i = 0; i < PHASEN.length; i++) {
    if (rest < PHASEN[i].dauer) return { index: i, inPhase: rest };
    rest -= PHASEN[i].dauer;
  }
  return { index: PHASEN.length - 1, inPhase: rest };
}

function bild() {
  if (!zustand.laeuft || zustand.pausiert) return;
  const { index, inPhase } = phaseZu(vergangeneSekunden() + zustand.versatz);
  if (index !== zustand.phase) zeigePhase(index);
  if (PHASEN[index].name === "erden") zeigeErden(inPhase);
  // Atemkreis folgt dem Ton, wenn er läuft – sonst der Uhr.
  const t = ton.zeitImZyklus() ?? ((performance.now() - zustand.atemAnker) / 1000) % ton.ZYKLUS;
  zeigeAtem(t);
  zustand.bild = requestAnimationFrame(bild);
}

function meldeTon(versuch) {
  versuch.then((laeuft) => {
    document.documentElement.dataset.ton = laeuft ? "an" : "blockiert";
  });
}

/* ---------------- Ablauf steuern ---------------- */

/**
 * Startet den Ablauf. MUSS direkt im Tipp-Ereignis aufgerufen werden (iOS gibt Ton nur dann frei).
 * @param {"ankommen"|"atmen"} ab  Ab welcher Phase („Noch eine Runde“ beginnt bei Atmen).
 */
export function starte(ab = "ankommen") {
  meldeTon(ton.starte());
  document.documentElement.dataset.ablauf = "laeuft"; // hält App-Updates zurück (app.js)
  const jetzt = performance.now();
  zustand.laeuft = true;
  zustand.lauf += 1;
  zustand.pausiert = false;
  zustand.angesammelt = 0;
  zustand.aktivSeit = jetzt;
  zustand.atemAnker = jetzt;
  zustand.versatz = 0;
  for (const p of PHASEN) {
    if (p.name === ab) break;
    zustand.versatz += p.dauer;
  }
  zustand.phase = -1;
  $("#akut-ablauf").hidden = false;
  $("#akut-unten").hidden = false;
  $("#abschluss").hidden = true;
  cancelAnimationFrame(zustand.bild);
  zustand.bild = requestAnimationFrame(bild);
  holeWachSperre();
}

/** „Sanft beenden“: Ton läuft bis zur nächsten Stille aus, dann die Abschluss-Frage. */
function zeigeAbschluss() {
  zustand.laeuft = false;
  cancelAnimationFrame(zustand.bild);
  ton.stoppeSanft();
  gibWachSperreFrei();
  sage("#phase-vorlesen", zeigePunkte(PHASEN.length));
  $("#akut").dataset.phase = "abschluss";
  $("#akut-ablauf").hidden = true;
  $("#akut-unten").hidden = true;
  $("#abschluss").hidden = false;
  $("#abschluss-frage").focus({ preventScroll: true });
}

/** Hintergrund: Ablauf anhalten. */
function pausiere() {
  if (!zustand.laeuft || zustand.pausiert) return;
  zustand.angesammelt += performance.now() - zustand.aktivSeit;
  zustand.pausiert = true;
  cancelAnimationFrame(zustand.bild);
}

/** Vordergrund: an derselben Stelle weiter, mit einem neuen Atemzug. */
function setzeFort() {
  if (!zustand.laeuft || !zustand.pausiert) return;
  const jetzt = performance.now();
  zustand.pausiert = false;
  zustand.aktivSeit = jetzt;
  zustand.atemAnker = jetzt;
  zustand.atemWort = "";
  meldeTon(ton.setzeFort());
  holeWachSperre();
  zustand.bild = requestAnimationFrame(bild);
}

/** Die Ansicht wird verlassen (Start, Hilfe, Zurück-Geste): alles sanft beenden. */
export function verlasse() {
  if (document.documentElement.dataset.ablauf !== "laeuft") return;
  zustand.laeuft = false;
  zustand.pausiert = false;
  cancelAnimationFrame(zustand.bild);
  ton.stoppeSanft();
  gibWachSperreFrei();
  $("#akut-unten").hidden = true;
  delete document.documentElement.dataset.ablauf;
}

/** Läuft gerade ein Ablauf (Phasen 1–4)? */
export function laeuft() {
  return zustand.laeuft;
}

/** Einmal beim Start der App: Knöpfe verbinden, Ton vorbereiten. */
export function richteEin() {
  ton.bereiteVor();
  $("#sanft-beenden").addEventListener("click", zeigeAbschluss);
  $("#abschluss-ruhiger").addEventListener("click", () => {
    location.hash = "#start";
  });
  $("#abschluss-nochmal").addEventListener("click", () => {
    starte("atmen");
    // Der gedrückte Knopf verschwindet – Fokus in den Ablauf, damit VoiceOver dort weiterliest.
    $("#akut-titel").focus({ preventScroll: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") pausiere();
    else setzeFort();
  });
}
