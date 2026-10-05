'use strict';

/*
 * Retter MilkDrop-ligninger (EEL), som milkdrop-preset-converters parser afviser, før konverteringen
 * (scripts/convert-presets.js). Fundet 05-10-2026 på Winamps egne presets, hvor bl.a. "Flexi - oldschool tree"
 * gav "Parse error": MilkDrop tillader et plus foran et tal, en variabel eller en funktion (unært plus), fx
 *   q2 = sin(+atan2(x4-x3,y4-y3) - asin(1)*2)*0.2;
 * Det plus betyder ingenting og fjernes, når det står efter en startparentes, et komma, et lighedstegn eller en
 * anden operator. Et almindeligt "a + b" røres ikke.
 */

const EQ_LINE = /^((?:per_frame|per_pixel|per_frame_init|wave_\d+_(?:init|per_frame|per_point)|shape_\d+_(?:init|per_frame))_?\d*=)(.*)$/;

function repairEelCode(code) {
  return code.replace(/([(,=*/%&|^<>!?:]|[-+*/]\s|^)(\s*)\+(?=\s*[\w.(])/g, '$1$2');
}

/** Hele .milk-teksten: kun lignings-linjerne ændres (ikke shaderne eller grundværdierne). */
function repairEel(text) {
  return text
    .split(/(\r?\n)/)
    .map((line) => {
      const m = line.match(EQ_LINE);
      return m ? m[1] + repairEelCode(m[2]) : line;
    })
    .join('');
}

module.exports = { repairEel, repairEelCode };
