/*
 * Hvor meget ligner to presets hinanden, og hvor godt passer et preset til en brugers favoritter? Bygger på
 * preset-katalogets vektorer (scripts/build-preset-catalog.js): målinger og kodetræk som placering 0-1.
 * Ren JavaScript; bruges af katalog-scriptet, testes i Node og kan bruges af rendereren.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisampPresetSimilarity = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 1 = ens, 0 = så forskellige som muligt (gennemsnitlig afstand pr. træk). */
  function similarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return 1 - d / a.length;
  }

  /**
   * Hvor godt et preset passer til en smag: ligheden med de mest lignende favoritter (gennemsnit af de `k`
   * bedste), minus det samme for de afviste (derez), hvis der er nogen. Over 0 = mere som favoritterne.
   */
  function affinity(f, likes, dislikes = [], k = 3) {
    const top = (list) => {
      const s = list.map((x) => similarity(f, x)).sort((a, b) => b - a).slice(0, k);
      return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
    };
    const like = top(likes);
    const dislike = top(dislikes);
    if (like === null) return 0;
    return dislike === null ? like - 0.5 : like - dislike;
  }

  return { similarity, affinity };
});
