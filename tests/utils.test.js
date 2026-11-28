'use strict';
// 🧪 本体1のユーティリティ（ゆらぎ・時刻・時間帯・座標変換）のテスト
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent, plain } = require('./harness');

const { api } = loadContent();

test('parseLines: 空行と空白を取り除く', () => {
  assert.deepEqual(plain(api.parseLines(' a \n\n b \n')), ['a', 'b']);
  assert.deepEqual(plain(api.parseLines('')), []);
  assert.deepEqual(plain(api.parseLines(null)), []);
  assert.deepEqual(plain(api.parseLines('1行だけ')), ['1行だけ']);
});

test('clampPct: 0〜100 に収める', () => {
  assert.equal(api.clampPct(-5), 0);
  assert.equal(api.clampPct(105), 100);
  assert.equal(api.clampPct(42), 42);
});

test('pctOfPoint: 矩形に対する % 座標（端はクランプ）', () => {
  assert.equal(api.pctOfPoint(150, 100, 200), 25);
  assert.equal(api.pctOfPoint(50, 100, 200), 0);
  assert.equal(api.pctOfPoint(400, 100, 200), 100);
  assert.equal(api.pctOfPoint(10, 0, 0), 0);
});

test('hhmmOf / formatHMS: ゼロ埋め書式', () => {
  assert.equal(api.hhmmOf(new Date(2026, 0, 1, 9, 5)), '09:05');
  assert.equal(api.hhmmOf(new Date(2026, 0, 1, 23, 59)), '23:59');
  assert.equal(api.formatHMS(new Date(2026, 0, 1, 3, 4, 5)), '03:04:05');
});

test('inWindow: 通常の時間帯', () => {
  assert.equal(api.inWindow('', '', '12:00'), true);
  assert.equal(api.inWindow('09:00', '17:00', '08:59'), false);
  assert.equal(api.inWindow('09:00', '17:00', '09:00'), true);
  assert.equal(api.inWindow('09:00', '17:00', '17:00'), true);
  assert.equal(api.inWindow('09:00', '17:00', '17:01'), false);
});

test('inWindow: 日をまたぐ時間帯', () => {
  assert.equal(api.inWindow('22:00', '06:00', '23:30'), true);
  assert.equal(api.inWindow('22:00', '06:00', '05:59'), true);
  assert.equal(api.inWindow('22:00', '06:00', '06:00'), true);
  assert.equal(api.inWindow('22:00', '06:00', '12:00'), false);
});

test('inAllowWindow: 設定が空なら常に true', () => {
  api.setSettings({ allowFrom: '', allowTo: '' });
  assert.equal(api.inAllowWindow(), true);
});

test('jitterPct: ゆらぎ OFF では値をそのまま返す', () => {
  api.setSettings({ jitter: false });
  assert.equal(api.jitterPct(50, 1.5), 50);
  assert.equal(api.jitterPct(120, 1.5), 120);
});

test('jitterPct: ゆらぎ ON では範囲内に収まる', () => {
  api.setSettings({ jitter: true });
  for (let i = 0; i < 200; i += 1) {
    const v = api.jitterPct(50, 1.5);
    assert.ok(v >= 48.5 && v <= 51.5, `範囲外: ${v}`);
    const edge = api.jitterPct(0, 1.5);
    assert.ok(edge >= 0 && edge <= 1.5, `クランプされていない: ${edge}`);
  }
});

test('jitterMs: ゆらぎ OFF では恒等、ON では 0.85〜1.30 倍', () => {
  api.setSettings({ jitter: false });
  assert.equal(api.jitterMs(2000), 2000);
  api.setSettings({ jitter: true });
  for (let i = 0; i < 200; i += 1) {
    const v = api.jitterMs(2000);
    assert.ok(v >= 1700 && v <= 2600, `範囲外: ${v}`);
  }
});
