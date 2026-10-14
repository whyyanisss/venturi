(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VenturiWire = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
"use strict";
/**
 * Tracé des fils (logique pure). Un fil « normal » fait horizontal → vertical → horizontal ;
 * le segment vertical peut être déplacé par l'utilisateur et mémorisé dans le lien (`mx`).
 */

/** Plage où le segment vertical peut se placer pour un fil de x1 (sortie) à x2 (entrée). */
const range = (x1, x2) => [x1 + 12, x2 - 19];

/** Abscisse du segment vertical : `mx` (bornée) s'il est défini, sinon le milieu. */
function midX(x1, x2, mx) {
  if (typeof mx !== "number" || !isFinite(mx)) return Math.round((x1 + x2) / 2);
  const [lo, hi] = range(x1, x2);
  return Math.min(Math.max(mx, lo), hi);
}

/** Ordonnée du canal horizontal d'un fil qui contourne : `my` bornée à [lo, hi] s'il est défini, sinon `def`. */
function chanY(def, my, lo, hi) {
  if (typeof my !== "number" || !isFinite(my)) return def;
  return Math.min(Math.max(my, lo), hi);
}

return { midX, range, chanY };
});
