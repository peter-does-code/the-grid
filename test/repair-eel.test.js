'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { repairEel, repairEelCode } = require('../scripts/lib/repair-eel.js');

test('unært plus fjernes (Flexi - oldschool tree), almindeligt plus bliver stående', () => {
  assert.equal(repairEelCode('q2 = sin(+atan2(x4-x3,y4-y3) - asin(1)*2)*0.2;'), 'q2 = sin(atan2(x4-x3,y4-y3) - asin(1)*2)*0.2;');
  assert.equal(repairEelCode('x = +0.5;'), 'x = 0.5;');
  assert.equal(repairEelCode('y = max(+a, +b);'), 'y = max(a, b);');
  assert.equal(repairEelCode('z = a + b + (c+d);'), 'z = a + b + (c+d);');
  assert.equal(repairEelCode('w = a* +b;'), 'w = a* b;');
});

test('kun lignings-linjer i .milk-teksten ændres', () => {
  const text = 'fDecay=1.000\r\nper_frame_3=q2 = sin(+atan2(a,b));\r\nwarp_1=`ret = +x;\r\nshape_1_per_frame2=x = +0.1;';
  assert.equal(repairEel(text), 'fDecay=1.000\r\nper_frame_3=q2 = sin(atan2(a,b));\r\nwarp_1=`ret = +x;\r\nshape_1_per_frame2=x = 0.1;');
});
