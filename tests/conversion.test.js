import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateConversion, CONVERSION_MODES, PITCH_AXIS_TOLERANCE } from '../conversion.js';

const close = (actual,expected,tolerance=1e-12) => assert.ok(Math.abs(actual-expected) <= tolerance*Math.max(1,Math.abs(expected)), `${actual} ≠ ${expected}`);
const size = (values={}) => ({mode:'size_to_pixels',width_mm:2880,height_mm:1620,pitch_mm:1.5,...values});
const pixels = (values={}) => ({mode:'pixels_to_size',pixels_w:1920,pixels_h:1080,pitch_mm:1.5,...values});
const inferred = (values={}) => ({mode:'infer_pitch',width_mm:2880,height_mm:1620,pixels_w:1920,pixels_h:1080,...values});

test('P1.5 converts 1920 × 1080 physical pixels into 2880 × 1620 active mm', () => {
  const result=calculateConversion(pixels());
  assert.deepEqual(result.active,{width_mm:2880,height_mm:1620});
  assert.deepEqual(calculateConversion(size()).pixels,{width:1920,height:1080});
  assert.deepEqual(calculateConversion(inferred()).pitch,{x_mm:1.5,y_mm:1.5});
  assert.equal(calculateConversion(inferred()).consistent,true);
});

test('fractional theoretical pixels stay distinct from rounded suggestion and actual signed drift', () => {
  const r=calculateConversion(size({width_mm:3000,height_mm:1700}));
  assert.equal(r.pixels.width,2000);
  close(r.pixels.height,1133+1/3);
  assert.deepEqual(r.integerSuggestion,{width_px:2000,height_px:1133,active_width_mm:3000,active_height_mm:1699.5,drift_width_mm:0,drift_height_mm:-0.5});
  const over=calculateConversion(size({width_mm:3000.9,height_mm:1700.9}));
  assert.equal(over.integerSuggestion.width_px,2001);
  close(over.integerSuggestion.drift_width_mm,0.6);
  close(over.integerSuggestion.drift_height_mm,0.1);
});

test('positive half pixels round up independently and a rounded zero gets no viable suggestion', () => {
  const half=calculateConversion(size({width_mm:3.75,height_mm:6.75,pitch_mm:1.5}));
  assert.deepEqual(half.pixels,{width:2.5,height:4.5});
  assert.deepEqual([half.integerSuggestion.width_px,half.integerSuggestion.height_px],[3,5]);
  assert.deepEqual([half.integerSuggestion.drift_width_mm,half.integerSuggestion.drift_height_mm],[0.75,0.75]);
  assert.equal(calculateConversion(size({width_mm:0.74,height_mm:100})).integerSuggestion,null);
  const one=calculateConversion(size({width_mm:0.75,height_mm:0.75}));
  assert.deepEqual([one.integerSuggestion.width_px,one.integerSuggestion.height_px],[1,1]);
});

test('inverse consistency holds across decimal pitches and emitting dimensions', () => {
  for(const pitch_mm of [0.9,1.25,1.5,1.5625,2.604166666666667,3.91]) {
    for(const [pixels_w,pixels_h] of [[1,1],[640,480],[1920,1080],[3840,2160]]) {
      const active=calculateConversion(pixels({pitch_mm,pixels_w,pixels_h})).active;
      const forward=calculateConversion(size({...active,pitch_mm}));
      close(forward.pixels.width,pixels_w);close(forward.pixels.height,pixels_h);
      assert.deepEqual([forward.integerSuggestion.width_px,forward.integerSuggestion.height_px],[pixels_w,pixels_h]);
      assert.deepEqual([forward.integerSuggestion.drift_width_mm,forward.integerSuggestion.drift_height_mm],[0,0]);
      const pitch=calculateConversion(inferred({...active,pixels_w,pixels_h}));
      close(pitch.pitch.x_mm,pitch_mm);close(pitch.pitch.y_mm,pitch_mm);
      assert.equal(pitch.consistent,true);
    }
  }
});

test('pitch inference preserves X and Y, flags materially different axes and never substitutes an average', () => {
  const unequal=calculateConversion(inferred({width_mm:3000,height_mm:1800}));
  assert.deepEqual(unequal.pitch,{x_mm:1.5625,y_mm:5/3});
  assert.equal(unequal.consistent,false);
  assert.ok(unequal.relativeDifference>PITCH_AXIS_TOLERANCE);
  assert.equal('pitch_mm' in unequal,false);
  const boundary=calculateConversion(inferred({width_mm:100,height_mm:99,pixels_w:100,pixels_h:100}));
  assert.equal(boundary.consistent,true);
  assert.equal(calculateConversion(inferred({width_mm:100,height_mm:98.99,pixels_w:100,pixels_h:100})).consistent,false);
  const slight=calculateConversion(inferred({width_mm:2880,height_mm:1620.01}));
  assert.notEqual(slight.pitch.x_mm,slight.pitch.y_mm);
  assert.equal(slight.consistent,true);
});

test('missing pitch explicitly explains why active size and pixels cannot determine each other', () => {
  for(const pitch_mm of [undefined,null,'',' ']) {
    assert.throws(()=>calculateConversion(size({pitch_mm})),/Pixel pitch.*required.*cannot be uniquely converted without pitch/);
    assert.throws(()=>calculateConversion(pixels({pitch_mm})),/Pixel pitch.*required.*cannot be uniquely converted without pitch/);
  }
  assert.doesNotThrow(()=>calculateConversion(inferred({pitch_mm:undefined})));
  for(const key of ['width_mm','height_mm']) assert.throws(()=>calculateConversion(size({[key]:''})),/required/);
  for(const key of ['pixels_w','pixels_h']) assert.throws(()=>calculateConversion(pixels({[key]:''})),/required/);
});

test('each relevant input rejects nonpositive, nonfinite, wrong-type and fractional physical pixel values', () => {
  const invalid=[0,-1,NaN,Infinity,-Infinity,'no',true,false,[],{}];
  for(const key of ['width_mm','height_mm','pitch_mm']) for(const value of invalid) assert.throws(()=>calculateConversion(size({[key]:value})),undefined,`${key}=${String(value)}`);
  for(const key of ['pixels_w','pixels_h']) for(const value of [...invalid,0.5,1920.25,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>calculateConversion(pixels({[key]:value})),undefined,`${key}=${String(value)}`);
    assert.throws(()=>calculateConversion(inferred({[key]:value})),undefined,`${key}=${String(value)}`);
  }
  assert.throws(()=>calculateConversion({mode:'unsupported'}),/valid conversion mode/);
  for(const raw of [null,undefined,[],1,'pixels']) assert.throws(()=>calculateConversion(raw),/must be an object/);
});

test('supported numerical bounds reject overflow, underflow and unsafe suggestions', () => {
  assert.throws(()=>calculateConversion(size({width_mm:1e300})),/numerical range/);
  assert.throws(()=>calculateConversion(size({pitch_mm:1e-300})),/numerical range/);
  assert.throws(()=>calculateConversion(pixels({pixels_w:Number.MAX_SAFE_INTEGER,pitch_mm:2})),/numerical range/);
  assert.throws(()=>calculateConversion(size({width_mm:Number.MIN_VALUE,pitch_mm:2})),/too small/);
  const maximal=calculateConversion(size({width_mm:Number.MAX_SAFE_INTEGER,height_mm:1,pitch_mm:1}));
  assert.equal(maximal.integerSuggestion.width_px,Number.MAX_SAFE_INTEGER);
  const tiny=calculateConversion(size({width_mm:1e-20,height_mm:2e-20,pitch_mm:1e-20}));
  assert.deepEqual(tiny.pixels,{width:1,height:2});
});

test('conversion is deterministic, leaves inputs unchanged and ignores unrelated frame/library data', () => {
  const raw=Object.freeze({...size(),frame_width_mm:9999,frame_height_mm:9999,panels:[{anything:'unchanged'}]});
  const before=JSON.stringify(raw);
  assert.deepEqual(calculateConversion(raw),calculateConversion({...size()}));
  assert.equal(JSON.stringify(raw),before);
  assert.deepEqual(Object.keys(CONVERSION_MODES),['size_to_pixels','pixels_to_size','infer_pitch']);
  assert.ok(Object.isFrozen(CONVERSION_MODES));
  const saved=JSON.parse(JSON.stringify({...size(),version:1}));
  assert.deepEqual(calculateConversion(saved),calculateConversion(size()));
});


test('decimal half-up suggestions distinguish exact halves from genuine lower near-halves', () => {
  for(const [width_mm,pitch_mm,expected] of [[4990.7,2.6,1920],[392.955,3.91,101]]) {
    const real = calculateConversion(size({width_mm,height_mm:width_mm,pitch_mm}));
    assert.equal(real.integerSuggestion.width_px,expected);
  }
  const exact = calculateConversion(size({width_mm:0.15,height_mm:0.25,pitch_mm:0.1}));
  assert.deepEqual([exact.integerSuggestion.width_px,exact.integerSuggestion.height_px],[2,3]);
  close(exact.integerSuggestion.drift_width_mm,0.05);
  const below = calculateConversion(size({width_mm:0.14999999999999997,height_mm:0.24999999999999997,pitch_mm:0.1}));
  assert.deepEqual([below.integerSuggestion.width_px,below.integerSuggestion.height_px],[1,2]);
  const scientific = calculateConversion(size({width_mm:1.5e-20,height_mm:2.5e-20,pitch_mm:1e-20}));
  assert.deepEqual([scientific.integerSuggestion.width_px,scientific.integerSuggestion.height_px],[2,3]);
});

test('large supported dimensions preserve material drift rather than erasing it as noise', () => {
  const r = calculateConversion(size({width_mm:1000000000000000.5,height_mm:1,pitch_mm:1}));
  assert.equal(r.integerSuggestion.width_px,1000000000000001);
  assert.equal(r.integerSuggestion.drift_width_mm,0.5);
  const below = calculateConversion(size({width_mm:1000000000000000.25,height_mm:1,pitch_mm:1}));
  assert.equal(below.integerSuggestion.drift_width_mm,-0.25);
});
