/*
 * Punch: mere kontrast i de lydniveauer, Butterchurn giver presets. Butterchurn regner som MilkDrop 2 bass, mid og treb
 * (og de glattede bass_att, mid_att, treb_att) som forhold mod de seneste ca. 4 sekunder, så 1,0 er "som det plejer",
 * og et højere omkvæd ser efter få sekunder ud som gennemsnittet igen. Punch spreder værdierne ud omkring 1:
 *
 *   v' = max(0, 1 + k·(v − 1))
 *
 * Med k = 1,3 bliver et slag på 1,5 til 1,65, og pauserne imellem falder fra 0,7 til 0,61. Gennemsnittet (1,0)
 * flytter sig ikke, så rolige presets forbliver rolige. Rammer alle presets; blink-vagten måler stadig billedet.
 *
 * wrapAudioLevels() lægger sig om Butterchurns `renderer.audioLevels` (Butterchurn 2.6.7, låst): render() kalder
 * updateAudioLevels(fps, frame) og læser derefter de seks værdier; loadPreset() læser de samme seks. Ingen andre
 * steder i Butterchurn læser objektet.
 * Ren JavaScript (ingen DOM), testet i test/punch.test.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisampPunch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PUNCH_K = 1.3;
  const LEVEL_KEYS = ['bass', 'bass_att', 'mid', 'mid_att', 'treb', 'treb_att'];

  function punchValue(v, k) {
    return Math.max(0, 1 + k * (v - 1));
  }

  /** De seks niveauer med punch (k = 1: uændret). */
  function punchLevels(levels, k = PUNCH_K) {
    const out = {};
    for (const key of LEVEL_KEYS) out[key] = punchValue(levels[key], k);
    return out;
  }

  /**
   * Et objekt, der kan stå i stedet for Butterchurns AudioLevels: updateAudioLevels kalder originalen, og de seks
   * niveauer læses fra originalen med punch. `getK()` spørges ved hver læsning, så indstillingen virker med det samme.
   */
  function wrapAudioLevels(original, getK) {
    if (!original || typeof original.updateAudioLevels !== 'function') {
      throw new TypeError('wrapAudioLevels: not a Butterchurn AudioLevels object');
    }
    const wrapper = {
      original,
      updateAudioLevels(fps, frame) {
        return original.updateAudioLevels(fps, frame);
      },
    };
    for (const key of LEVEL_KEYS) {
      Object.defineProperty(wrapper, key, { enumerable: true, get: () => punchValue(original[key], getK()) });
    }
    return wrapper;
  }

  return { PUNCH_K, LEVEL_KEYS, punchValue, punchLevels, wrapAudioLevels };
});
