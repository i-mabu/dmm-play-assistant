'use strict';
// 🧪 本体3〜5の補助ロジック（シナリオ・日次上限・巡回・報告文・画面状態）のテスト
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent, plain } = require('./harness');

const { api, state } = loadContent();

test('clampScenarioDelay: 既定800ms、上限60秒', () => {
  assert.equal(api.clampScenarioDelay(undefined), 800);
  assert.equal(api.clampScenarioDelay(0), 800);
  assert.equal(api.clampScenarioDelay(500), 500);
  assert.equal(api.clampScenarioDelay(999999), 60000);
});

test('findActiveScenario: 名前で探し、無ければ null', () => {
  api.setSettings({
    scenarios: [{ name: 'a', steps: [] }, { name: 'b', steps: [1] }],
    activeScenario: 'b',
  });
  assert.equal(api.findActiveScenario().name, 'b');
  api.setSettings({ activeScenario: 'zzz' });
  assert.equal(api.findActiveScenario(), null);
});

test('dangerWordList: 既定リストとカスタムの切り替え', () => {
  api.setSettings({ dangerWordsText: '' });
  assert.deepEqual(plain(api.dangerWordList()), plain(api.DANGER_WORDS));
  api.setSettings({ dangerWordsText: '購入確認\n独自ワード\n' });
  assert.deepEqual(plain(api.dangerWordList()), ['購入確認', '独自ワード']);
});

test('readDailyCount: 日付が今日のときだけ回数を返す', () => {
  const raw = JSON.stringify({ date: 'Tue Nov 24 2026', count: 5 });
  assert.equal(api.readDailyCount(raw, 'Tue Nov 24 2026'), 5);
  assert.equal(api.readDailyCount(raw, 'Wed Nov 25 2026'), 0);
  assert.equal(api.readDailyCount('壊れたJSON', 'Tue Nov 24 2026'), 0);
  assert.equal(api.readDailyCount(null, 'Tue Nov 24 2026'), 0);
});

test('bumpedDaily: 同日は+1、日付が変われば1から', () => {
  assert.deepEqual(
    plain(api.bumpedDaily(JSON.stringify({ date: 'D1', count: 5 }), 'D1')),
    { date: 'D1', count: 6 },
  );
  assert.deepEqual(
    plain(api.bumpedDaily(JSON.stringify({ date: 'D1', count: 5 }), 'D2')),
    { date: 'D2', count: 1 },
  );
  assert.deepEqual(plain(api.bumpedDaily(null, 'D2')), { date: 'D2', count: 1 });
});

test('buildScenarioSteps: 時刻順に並べ、間隔を 0〜60秒に収める', () => {
  const rec = { name: 's', startedAt: 1000 };
  const buf = [
    { type: 'click', x: 1, y: 2, t: 4000 },
    { type: 'key', key: 'space', t: 2000 },
    { type: 'click', x: 3, y: 4, t: 2000 + 120000 },
  ];
  const steps = api.buildScenarioSteps(rec, buf);
  assert.equal(steps.length, 3);
  assert.equal(steps[0].type, 'key');
  assert.equal(steps[0].key, 'space');
  assert.equal(steps[0].delayMs, 1000);
  assert.equal(steps[1].delayMs, 2000);
  assert.equal(steps[2].delayMs, 60000); // 120秒の間隔は60秒に丸める
  assert.deepEqual(plain(api.buildScenarioSteps(rec, [])), []);
});

test('patrolNextUrl: 次の URL（末尾なら先頭、未知なら先頭）', () => {
  const urls = ['https://a/', 'https://b/', 'https://c/'];
  assert.equal(api.patrolNextUrl(urls, 'https://b/play'), 'https://c/');
  assert.equal(api.patrolNextUrl(urls, 'https://c/x'), 'https://a/');
  assert.equal(api.patrolNextUrl(urls, 'https://unknown/'), 'https://a/');
});

test('buildReportText: 報告文の書式', () => {
  const text = api.buildReportText({
    title: 'タイトル',
    href: 'https://play.games.dmm.com/game',
    mode: 'play',
    clickCount: 12,
    reloadCount: 1,
    events: [{ time: '10:00:00', msg: '開始（モード: play）' }],
  });
  assert.equal(text, [
    '',
    'ページ: タイトル https://play.games.dmm.com/game',
    'モード: play / クリック回数: 12 / 再読み込み: 1回',
    'イベント:',
    '- 10:00:00 開始（モード: play）',
    '→ Museへ: この内容を作業まとめアプリへ記録してください。',
  ].join('\n'));
});

test('PROFILE_FIELDS: プロファイル対象の11項目', () => {
  assert.deepEqual(plain(api.PROFILE_FIELDS), [
    'mode', 'settleSec', 'intervalSec', 'holdMs', 'advanceMethod', 'points',
    'templates', 'strictWhitelist', 'whitelist', 'activeScenario', 'scenarioLoop',
  ]);
});

test('pointFromEvent: ゲーム画面あり／なし／壊れた矩形', () => {
  const area = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 100 }) };
  assert.deepEqual(plain(api.pointFromEvent({ clientX: 200, clientY: 100 }, area)), { x: 50, y: 50 });
  assert.deepEqual(plain(api.pointFromEvent({ clientX: 640, clientY: 360 }, null)), { x: 50, y: 50 });
  const broken = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) };
  assert.deepEqual(plain(api.pointFromEvent({ clientX: 10, clientY: 10 }, broken)), { x: 50, y: 78 });
});

test('isPlayerFrame: canvas が画面の35%以上で対象フレーム', () => {
  state.canvases = [{
    width: 800, height: 450,
    getBoundingClientRect: () => ({ width: 800, height: 450 }),
  }];
  assert.equal(api.isPlayerFrame(), true); // 800*450 / (1280*720) ≒ 0.39
  state.canvases = [{
    width: 100, height: 100,
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
  }];
  assert.equal(api.isPlayerFrame(), false);
  state.canvases = [];
  assert.equal(api.isPlayerFrame(), false);
});

test('canvasState: 中間色は blank でなく、真っ白／真っ黒は blank', () => {
  state.canvases = [{
    width: 64, height: 36,
    getBoundingClientRect: () => ({ width: 64, height: 36 }),
  }];
  state.sampleData.fill(128);
  const mid = api.canvasState();
  assert.equal(mid.blank, false);
  state.sampleData.fill(255);
  assert.equal(api.canvasState().blank, true);
  state.sampleData.fill(0);
  assert.equal(api.canvasState().blank, true);
  state.sampleData.fill(128);
  const first = api.canvasState();
  state.sampleData[0] = 200;
  assert.notEqual(api.canvasState().hash, first.hash);
  state.canvases = [];
  assert.equal(api.canvasState(), null);
});
