'use strict';

const zlib = require('node:zlib');

/**
 * Tegner app-ikonet — en identitetsdisk fra Tron: en lysende cyan ring med en tynd indre ring og
 * en kerne, på sort — og koder det som PNG, så der ikke skal ligge en binær ikonfil i repoet.
 */
function renderIconRgba(size = 64) {
  const pixels = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const px = 1 / size; // én pixel i enheder af ikonets bredde
  // Ringe: [radius, halv tykkelse, styrke]
  const rings = [
    [0.4, 0.045, 1],
    [0.24, 0.018, 0.75],
  ];
  const cyan = [0, 229, 255];
  const core = [225, 253, 255];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / size;
      let light = 0;
      let hot = 0;
      for (const [radius, half, strength] of rings) {
        const edge = Math.abs(d - radius) - half;
        const solid = Math.min(1, Math.max(0, 0.5 - edge / px)); // kantudglattet ring
        const glow = Math.exp(-Math.max(0, edge) / 0.035) * 0.55;
        light = Math.max(light, strength * Math.max(solid, glow));
        hot = Math.max(hot, strength * solid * Math.min(1, Math.max(0, 1 - (Math.abs(d - radius) / half) * 0.9)));
      }
      // Kernen i midten.
      const coreEdge = d - 0.07;
      const coreSolid = Math.min(1, Math.max(0, 0.5 - coreEdge / px));
      light = Math.max(light, coreSolid, Math.exp(-Math.max(0, coreEdge) / 0.03) * 0.5);
      hot = Math.max(hot, coreSolid * 0.8);

      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        const base = 2 + (k === 2 ? 5 : k === 1 ? 3 : 0); // næsten sort med et strejf af blå
        const color = cyan[k] + (core[k] - cyan[k]) * hot;
        pixels[i + k] = Math.round(Math.min(255, base + color * light));
      }
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData) >>> 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(rgba, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bitdybde
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0; // filtertype "none"
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function iconPng(size = 64) {
  return encodePng(renderIconRgba(size), size, size);
}

module.exports = { iconPng, encodePng, renderIconRgba };
