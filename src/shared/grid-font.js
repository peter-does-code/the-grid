/*
 * Lyscykel-skrift: hvert bogstav er streger af lige linjer med 90-graders sving, så lyscyklerne
 * i introen kan "køre" bogstaverne, præcis som cyklerne i Tron kun kan dreje skarpt.
 * Enheder: bogstaverne er 6 høje og (typisk) 4 brede, y går nedad.
 * Indlæses både som <script> (window.GridFont) og via require() i tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GridFont = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HEIGHT = 6;
  const LETTER_GAP = 1.6;
  const SPACE = 3;

  // [bredde, streger]; hver streg er en liste af punkter.
  const GLYPHS = {
    A: [4, [[[0, 6], [0, 0], [4, 0], [4, 6]], [[0, 3], [4, 3]]]],
    B: [4, [[[0, 0], [0, 6], [4, 6], [4, 3], [0, 3]], [[0, 0], [3, 0], [3, 3]]]],
    C: [4, [[[4, 0], [0, 0], [0, 6], [4, 6]]]],
    D: [4, [[[0, 0], [0, 6], [3, 6], [3, 5], [4, 5], [4, 1], [3, 1], [3, 0], [0, 0]]]],
    E: [4, [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]]],
    F: [4, [[[4, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]]],
    G: [4, [[[4, 0], [0, 0], [0, 6], [4, 6], [4, 3], [2, 3]]]],
    H: [4, [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]]],
    I: [1, [[[0.5, 0], [0.5, 6]]]],
    J: [4, [[[4, 0], [4, 6], [0, 6], [0, 4]]]],
    K: [4, [[[0, 0], [0, 6]], [[4, 0], [4, 2], [2, 2], [2, 4], [4, 4], [4, 6]], [[0, 3], [2, 3]]]],
    L: [4, [[[0, 0], [0, 6], [4, 6]]]],
    M: [4, [[[0, 6], [0, 0], [4, 0], [4, 6]], [[2, 0], [2, 3]]]],
    N: [4, [[[0, 6], [0, 0], [2, 0], [2, 6], [4, 6], [4, 0]]]],
    O: [4, [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]]]],
    P: [4, [[[0, 6], [0, 0], [4, 0], [4, 3], [0, 3]]]],
    Q: [4, [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]], [[2, 4], [2, 5], [4, 5]]]],
    R: [4, [[[0, 6], [0, 0], [4, 0], [4, 3], [0, 3]], [[2, 3], [2, 4.5], [4, 4.5], [4, 6]]]],
    S: [4, [[[4, 0], [0, 0], [0, 3], [4, 3], [4, 6], [0, 6]]]],
    T: [4, [[[0, 0], [4, 0]], [[2, 0], [2, 6]]]],
    U: [4, [[[0, 0], [0, 6], [4, 6], [4, 0]]]],
    V: [4, [[[0, 0], [0, 5], [1, 5], [1, 6], [3, 6], [3, 5], [4, 5], [4, 0]]]],
    W: [4, [[[0, 0], [0, 6], [4, 6], [4, 0]], [[2, 6], [2, 3]]]],
    X: [4, [[[0, 0], [0, 2], [4, 2], [4, 0]], [[0, 6], [0, 4], [4, 4], [4, 6]], [[2, 2], [2, 4]]]],
    Y: [4, [[[0, 0], [0, 3], [4, 3], [4, 0]], [[2, 3], [2, 6]]]],
    Z: [4, [[[0, 0], [4, 0], [4, 3], [0, 3], [0, 6], [4, 6]]]],
    '0': [4, [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]]]],
    '1': [2, [[[0, 1], [1, 1], [1, 0], [1, 6]]]],
    '2': [4, [[[0, 0], [4, 0], [4, 3], [0, 3], [0, 6], [4, 6]]]],
    '.': [1, [[[0, 6], [1, 6]]]],
    '!': [1, [[[0.5, 0], [0.5, 4]], [[0.5, 5.5], [0.5, 6]]]],
    ':': [1, [[[0.5, 1.5], [0.5, 2]], [[0.5, 4.5], [0.5, 5]]]],
    '-': [3, [[[0, 3], [3, 3]]]],
  };

  function lineWidth(text) {
    let w = 0;
    const chars = String(text).toUpperCase().split('');
    chars.forEach((ch, i) => {
      if (ch === ' ') w += SPACE;
      else w += (GLYPHS[ch] ? GLYPHS[ch][0] : 4) + (i < chars.length - 1 && chars[i + 1] !== ' ' ? LETTER_GAP : 0);
    });
    return w;
  }

  /**
   * Lægger tekstlinjer ud centreret om (0,0) i enheder. Returnerer én post pr. streg:
   * { line, letter, index (løbenummer), points: [[x,y],...], length }.
   */
  function layout(lines, { lineGap = 3 } = {}) {
    const strokes = [];
    const totalHeight = lines.length * HEIGHT + (lines.length - 1) * lineGap;
    let letterIndex = 0;
    lines.forEach((text, lineNo) => {
      const width = lineWidth(text);
      let x = -width / 2;
      const y = -totalHeight / 2 + lineNo * (HEIGHT + lineGap);
      const chars = String(text).toUpperCase().split('');
      chars.forEach((ch, i) => {
        if (ch === ' ') {
          x += SPACE;
          return;
        }
        const glyph = GLYPHS[ch];
        if (glyph) {
          for (const stroke of glyph[1]) {
            const points = stroke.map(([px, py]) => [x + px, y + py]);
            let length = 0;
            for (let p = 1; p < points.length; p++) {
              length += Math.abs(points[p][0] - points[p - 1][0]) + Math.abs(points[p][1] - points[p - 1][1]);
            }
            strokes.push({ line: lineNo, letter: letterIndex, char: ch, points, length });
          }
        }
        letterIndex += 1;
        x += (glyph ? glyph[0] : 4) + (i < chars.length - 1 && chars[i + 1] !== ' ' ? LETTER_GAP : 0);
      });
    });
    const maxWidth = Math.max(...lines.map(lineWidth));
    return { strokes, width: maxWidth, height: totalHeight, letters: letterIndex };
  }

  /** Punktet en given strækning inde i stregen. */
  function pointAt(points, distance) {
    let left = distance;
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const seg = Math.abs(x1 - x0) + Math.abs(y1 - y0);
      if (left <= seg || i === points.length - 1) {
        const f = seg === 0 ? 1 : Math.min(1, left / seg);
        return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, segment: i, dx: Math.sign(x1 - x0), dy: Math.sign(y1 - y0) };
      }
      left -= seg;
    }
    const last = points[points.length - 1];
    return { x: last[0], y: last[1], segment: points.length - 1, dx: 0, dy: 0 };
  }

  return { GLYPHS, HEIGHT, layout, lineWidth, pointAt };
});
