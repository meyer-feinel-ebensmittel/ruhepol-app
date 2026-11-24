/*
  Ruhepol – Platzhalter-Ton (Bauschritt 3)

  Bis die vertraute Stimme (Bauschritt 4) und die Klänge (Bauschritt 5) da sind,
  begleitet ein leiser, warmer Ton den Ablauf. Er wird hier im Gerät erzeugt –
  keine Datei, keine Verbindung nach außen.

  So klingt er:
    - zwei weiche Sinustöne (G und D, eine Quinte), sehr leise (höchstens 12 %),
    - er schwillt im Atemtakt an und ab: 4 Sekunden lauter (einatmen),
      6 Sekunden leiser (ausatmen), dann wieder Stille – ein Zyklus = 10 Sekunden,
    - er beginnt und endet in Stille: kein plötzlicher Ton.
  Warum der Takt im Ton selbst steckt: Auf dem iPhone lässt sich die Lautstärke
  eines Audio-Elements nicht per Programm ändern. Ein- und Ausblenden geht nur so.

  Regeln für sanfte Übergänge (Befund Codex Runde 3, Nr. 4):
    - Beenden: Der Ton spielt bis zum nächsten stillen Punkt. Gemessen wird an der
      Tonposition selbst (nicht an einer Uhr), so passt es auch nach Unterbrechungen.
    - Wiederholen während des Ausklingens: Der Ton läuft einfach weiter – kein Sprung.
    - Fortsetzen nach einer Unterbrechung: immer am Anfang eines Atemzugs (= Stille).

  Vor jedem Abspielen: navigator.audioSession.type = "playback" (Ergebnis iPhone-Test,
  Bauschritt 1: so klingt der Ton auch bei Stummschalter und über den Lautsprecher).
*/

export const ZYKLUS = 10; // Sekunden: 4 ein + 6 aus
export const EIN = 4;

const RATE = 22050;
const LAUTSTAERKE = 0.12;

let spieler = null;
let ausklingen = null; // Prüf-Takt, solange der Ton zur nächsten Stille ausläuft
let letzteStelle = 0;

/** Hüllkurve: 0 → 1 in 4 s (weich), 1 → 0 in 6 s (weich). */
function huelle(t) {
  if (t < EIN) return 0.5 - 0.5 * Math.cos((Math.PI * t) / EIN);
  return 0.5 + 0.5 * Math.cos((Math.PI * (t - EIN)) / (ZYKLUS - EIN));
}

/** Erzeugt den Ton als WAV-Datei im Speicher (16 Bit, mono). */
function erzeugeWav() {
  const anzahl = RATE * ZYKLUS;
  const puffer = new ArrayBuffer(44 + anzahl * 2);
  const d = new DataView(puffer);
  const text = (pos, s) => [...s].forEach((c, i) => d.setUint8(pos + i, c.charCodeAt(0)));
  text(0, "RIFF");
  d.setUint32(4, 36 + anzahl * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true); // PCM
  d.setUint16(22, 1, true); // mono
  d.setUint32(24, RATE, true);
  d.setUint32(28, RATE * 2, true);
  d.setUint16(32, 2, true);
  d.setUint16(34, 16, true);
  text(36, "data");
  d.setUint32(40, anzahl * 2, true);
  // 196 Hz und 294 Hz passen ganzzahlig in 10 s → die Schleife hat keinen hörbaren Übergang.
  for (let i = 0; i < anzahl; i++) {
    const t = i / RATE;
    const klang = 0.7 * Math.sin(2 * Math.PI * 196 * t) + 0.3 * Math.sin(2 * Math.PI * 294 * t);
    const wert = LAUTSTAERKE * huelle(t) * klang;
    d.setInt16(44 + i * 2, Math.round(wert * 32767), true);
  }
  return new Blob([puffer], { type: "audio/wav" });
}

function setzeSitzung() {
  try {
    if ("audioSession" in navigator) navigator.audioSession.type = "playback";
  } catch {
    // ältere Geräte: ohne Audio-Sitzung weiter
  }
}

function beendeAusklingen() {
  clearInterval(ausklingen);
  ausklingen = null;
}

/** Spielt ab und meldet: true = Ton läuft, false = vom System blockiert. */
function spiele() {
  setzeSitzung();
  return Promise.resolve(spieler.play()).then(
    () => true,
    () => false,
  );
}

/** Einmal beim Laden der App: Ton vorbereiten, damit er beim Tippen sofort da ist. */
export function bereiteVor() {
  if (spieler) return;
  spieler = new Audio();
  spieler.loop = true;
  spieler.preload = "auto";
  spieler.src = URL.createObjectURL(erzeugeWav());
}

/**
 * Startet den Ton. Muss direkt im Tipp-Ereignis aufgerufen werden – sonst blockiert iOS ihn.
 * Läuft er noch (z. B. beim Ausklingen und „Noch eine Runde“), spielt er ohne Sprung weiter.
 * Ergebnis: true = Ton läuft, false = blockiert (der Ablauf läuft trotzdem, ohne Ton).
 */
export function starte() {
  bereiteVor();
  if (!spieler.paused) {
    beendeAusklingen();
    return Promise.resolve(true);
  }
  spieler.currentTime = 0; // Anfang = Stille
  return spiele();
}

/** Wo im Atemzyklus steht der Ton gerade? (Sekunden 0–10) – null, wenn er nicht läuft. */
export function zeitImZyklus() {
  if (!spieler || spieler.paused) return null;
  return spieler.currentTime % ZYKLUS;
}

/**
 * Sanft beenden: Der Ton läuft bis zum nächsten stillen Punkt (Ende des Ausatmens)
 * und hält dort an. Erkannt wird das daran, dass die Tonposition im Zyklus wieder
 * von vorn beginnt.
 */
export function stoppeSanft() {
  if (!spieler || spieler.paused || ausklingen) return;
  letzteStelle = spieler.currentTime % ZYKLUS;
  ausklingen = setInterval(() => {
    if (spieler.paused) return beendeAusklingen();
    const stelle = spieler.currentTime % ZYKLUS;
    if (stelle < letzteStelle) {
      spieler.pause();
      beendeAusklingen();
    }
    letzteStelle = stelle;
  }, 50);
}

/**
 * Nach dem Zurückkehren in die App: Hat das System den Ton angehalten, am Anfang des
 * aktuellen Atemzugs (Stille) weiterspielen. Ergebnis wie bei starte().
 */
export function setzeFort() {
  if (!spieler) return Promise.resolve(false);
  if (!spieler.paused) return Promise.resolve(true);
  spieler.currentTime = Math.floor(spieler.currentTime / ZYKLUS) * ZYKLUS;
  return spiele();
}
