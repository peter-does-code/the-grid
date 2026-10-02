'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { devicePixelRatio: 2.5 };
require('../src/renderer/visualizer.js');
const { Visualizer, LumaProbe } = global.window.Visamp;

const measure = (devicePixels, css = { width: 0, height: 0 }) =>
  Visualizer.prototype.measure.call({ devicePixels, canvas: { getBoundingClientRect: () => css } });

test('renderstørrelsen er de præcise skærmpixels, højst 3840 bred', () => {
  assert.deepEqual(measure({ width: 2559, height: 1439 }), { width: 2559, height: 1439 });
  assert.deepEqual(measure({ width: 3840, height: 2160 }), { width: 3840, height: 2160 }, '4K i fuld skærm: 1:1');
  assert.deepEqual(measure({ width: 5120, height: 2880 }), { width: 3840, height: 2160 }, '5K: samme form, 3840 bred');
  // Uden ResizeObserverens skærmpixels: CSS-pixels x devicePixelRatio, også over 2.
  assert.deepEqual(measure(null, { width: 1000, height: 600 }), { width: 2500, height: 1500 });
  assert.deepEqual(measure({ width: 0, height: 0 }), { width: 2, height: 2 });
});

test('størrelsesskift samles: det første med det samme, under et træk kun det sidste efter 100 ms', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resizes = 0;
  const fake = { lastSizeChange: -Infinity, resize: () => (resizes += 1) };
  const schedule = (now) => Visualizer.prototype.scheduleResize.call(fake, now);
  schedule(0);
  assert.equal(resizes, 1, 'første skift med det samme');
  let now = 0;
  for (let i = 0; i < 30; i++) {
    now += 16;
    t.mock.timers.tick(16);
    schedule(now);
  }
  assert.equal(resizes, 1, 'intet under trækket');
  t.mock.timers.tick(99);
  assert.equal(resizes, 1);
  t.mock.timers.tick(1);
  assert.equal(resizes, 2, 'det sidste 100 ms efter');
  schedule(now + 500);
  assert.equal(resizes, 3, 'efter en pause igen med det samme');
});

/** Et falsk WebGL2: husker bindinger og scissor, fylder pixel-bufferen med `fill` og melder hegnet klar på kommando. */
function fakeGl(fill) {
  const C = {
    FRAMEBUFFER: 1, READ_FRAMEBUFFER: 2, DRAW_FRAMEBUFFER: 3, READ_FRAMEBUFFER_BINDING: 4, DRAW_FRAMEBUFFER_BINDING: 5,
    RENDERBUFFER: 6, RGBA8: 7, COLOR_ATTACHMENT0: 8, PIXEL_PACK_BUFFER: 9, STREAM_READ: 10, SCISSOR_TEST: 11,
    COLOR_BUFFER_BIT: 12, LINEAR: 13, RGBA: 14, UNSIGNED_BYTE: 15, SYNC_GPU_COMMANDS_COMPLETE: 16, NO_ERROR: 0,
    TIMEOUT_EXPIRED: 17, ALREADY_SIGNALED: 18, CONDITION_SATISFIED: 19, WAIT_FAILED: 20,
  };
  const state = { read: 'butterchurn', draw: 'butterchurn', pack: null, scissor: true, ready: new Set(), blits: [], errors: [] };
  let id = 0;
  const gl = {
    ...C,
    state,
    getParameter: (p) => (p === C.READ_FRAMEBUFFER_BINDING ? state.read : p === C.DRAW_FRAMEBUFFER_BINDING ? state.draw : null),
    createRenderbuffer: () => ({ id: ++id }),
    createFramebuffer: () => ({ id: ++id, probe: true }),
    createBuffer: () => ({ id: ++id }),
    bindRenderbuffer() {},
    renderbufferStorage() {},
    framebufferRenderbuffer() {},
    bufferData() {},
    bindFramebuffer(target, fb) {
      if (target === C.READ_FRAMEBUFFER || target === C.FRAMEBUFFER) state.read = fb;
      if (target === C.DRAW_FRAMEBUFFER || target === C.FRAMEBUFFER) state.draw = fb;
    },
    bindBuffer(target, buffer) {
      if (target === C.PIXEL_PACK_BUFFER) state.pack = buffer;
    },
    isEnabled: (cap) => (cap === C.SCISSOR_TEST ? state.scissor : false),
    enable: (cap) => cap === C.SCISSOR_TEST && (state.scissor = true),
    disable: (cap) => cap === C.SCISSOR_TEST && (state.scissor = false),
    blitFramebuffer(...args) {
      state.blits.push({ args, read: state.read, draw: state.draw, scissor: state.scissor });
    },
    readPixels() {},
    fenceSync: () => ({ id: ++id }),
    flush() {},
    getError: () => (state.errors.length ? state.errors.shift() : C.NO_ERROR),
    clientWaitSync: (sync) => (state.ready.has(sync.id) ? C.ALREADY_SIGNALED : C.TIMEOUT_EXPIRED),
    deleteSync() {},
    getBufferSubData: (target, offset, dst) => dst.fill(fill),
    deleteBuffer() {},
    deleteFramebuffer() {},
    deleteRenderbuffer() {},
  };
  return gl;
}

test('lysstyrken læses asynkront, og Butterchurns GL-tilstand lægges tilbage', () => {
  const gl = fakeGl(255);
  const probe = new LumaProbe(gl);
  assert.equal(probe.capture(1920, 1080), true);
  const blit = gl.state.blits[0];
  assert.equal(blit.read, null, 'læser canvas-billedet');
  assert.ok(blit.draw && blit.draw.probe, 'ind i det lille billede');
  assert.equal(blit.scissor, false, 'uden scissor');
  assert.deepEqual(blit.args.slice(0, 8), [0, 0, 1920, 1080, 0, 0, 48, 27]);
  assert.equal(gl.state.read, 'butterchurn');
  assert.equal(gl.state.draw, 'butterchurn');
  assert.equal(gl.state.scissor, true);
  assert.equal(gl.state.pack, null);
  assert.equal(probe.failed, null);

  const got = [];
  probe.poll((l) => got.push(l));
  assert.deepEqual(got, [], "GPU'en er ikke færdig: ingen venten, intet svar");
  const sync = probe.slots.find((s) => s.sync).sync;
  gl.state.ready.add(sync.id);
  probe.poll((l) => got.push(l));
  assert.equal(got.length, 1);
  assert.ok(Math.abs(got[0] - 1) < 1e-9, 'hvidt billede = 1');
  assert.equal(gl.state.pack, null);
});

test('højst tre aflæsninger undervejs; en GL-fejl ved første aflæsning melder sig', () => {
  const gl = fakeGl(0);
  const probe = new LumaProbe(gl);
  assert.equal(probe.capture(100, 100), true);
  assert.equal(probe.capture(100, 100), true);
  assert.equal(probe.capture(100, 100), true);
  assert.equal(probe.capture(100, 100), false, 'springes over i stedet for at vente');
  probe.cancel();
  assert.equal(probe.capture(100, 100), true);

  const bad = fakeGl(0);
  const failing = new LumaProbe(bad);
  const capture = failing.capture.bind(failing);
  // Fejlen opstår først under selve aflæsningen (efter de gamle flag er ryddet).
  bad.blitFramebuffer = () => bad.state.errors.push(0x502);
  capture(100, 100);
  assert.equal(failing.failed, 'WebGL error 0x502');
});
