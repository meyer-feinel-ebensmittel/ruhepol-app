/*
  Ruhepol – Farbwelt früh setzen.
  Läuft im <head>, bevor die Seite gezeichnet wird. So erscheint die gewählte
  Farbwelt sofort – ohne kurzes Aufblitzen der Standardfarben.
  Nur diese eine Aufgabe; alles andere steht in app.js.
*/
"use strict";
(function () {
  var ERLAUBT = { nachtblau: "#0D1522", sand: "#F7F0E4", wald: "#12201A" };
  var wahl = "nachtblau";
  try {
    var gespeichert = localStorage.getItem("ruhepol-farbwelt");
    if (gespeichert && Object.prototype.hasOwnProperty.call(ERLAUBT, gespeichert)) wahl = gespeichert;
  } catch (e) {
    /* Speicher gesperrt (z. B. privater Modus): Standard bleibt */
  }
  document.documentElement.setAttribute("data-farbwelt", wahl);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", ERLAUBT[wahl]);
})();
