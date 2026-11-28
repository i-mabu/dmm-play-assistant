'use strict';
// 🧪 既定設定とストレージキーの互換性テスト
//    （既存ユーザーの保存済み設定がそのまま引き継がれることが前提）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadContent, ROOT, CONTENT_FILES, plain } = require('./harness');

const { api } = loadContent();

test('DEFAULT_SETTINGS: 旧版 v1.5.1 と同じキーと既定値', () => {
  assert.deepEqual(plain(api.DEFAULT_SETTINGS), {
    running: false,
    mode: 'play',
    settleSec: 4,
    intervalSec: 2,
    stallMin: 5,
    maxRunMin: 60,
    points: [{ x: 50, y: 78 }],
    advanceMethod: 'click',
    holdMs: 60,
    jitter: true,
    strictWhitelist: false,
    whitelist: '',
    dangerStop: true,
    dailyClickCap: 0,
    allowFrom: '',
    allowTo: '',
    scheduleStart: '',
    scheduleStop: '',
    patrol: false,
    patrolMin: 3,
    patrolUrls: '',
    shotOnStop: false,
    templates: [],
    stuckLimit: 3,
    scenarios: [],
    activeScenario: '',
    scenarioLoop: false,
    profiles: {},
    tplThreshold: 26,
    dangerWordsText: '',
    extraDomains: '',
  });
});

test('定数: 再読み込み上限と危険ワード既定リスト', () => {
  assert.equal(api.MAX_RELOADS, 3);
  assert.equal(api.TICK_MS, 1000);
  assert.deepEqual(plain(api.DANGER_WORDS), [
    '購入確認', '購入しますか', 'メンテナンス中', '通信エラー', 'エラーが発生', 'セッションが切れました',
  ]);
  assert.deepEqual(plain(api.DANGER_STRONG), ['購入確認', '購入しますか', 'セッションが切れました']);
});

test('ストレージキー: 旧版と同じキー名がソースに存在する', () => {
  const all = [...CONTENT_FILES, 'background.js']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');
  for (const key of [
    'mpaSettings', 'mpaRecording', 'mpaRecordBuffer',
    'mpa-reloads:', 'mpa-log:', 'mpa-daily', 'mpa-run-started', 'mpa-patrol:',
  ]) {
    assert.ok(all.includes(key), `キー ${key} が見つかりません`);
  }
});

test('フレーム間メッセージ: 旧版と同じ type 名がソースに存在する', () => {
  const all = CONTENT_FILES
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');
  for (const type of ['mpa-click', 'mpa-activity', 'mpa-action', 'mpa-stuck', 'mpa-scenario-done']) {
    assert.ok(all.includes(`'${type}'`), `メッセージ ${type} が見つかりません`);
  }
});
