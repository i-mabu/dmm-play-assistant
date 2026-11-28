'use strict';
// 🧪 本体2のボタン判定（拒否ワード・ガチャ制限・優先順ルール）と
//    画像マッチングのスコア計算のテスト
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent } = require('./harness');

const { api, state } = loadContent();

test('normalizeButtonText: 空白を正規化する', () => {
  assert.equal(api.normalizeButtonText('  閉じる \n ボタン '), '閉じる ボタン');
  assert.equal(api.normalizeButtonText(''), '');
  assert.equal(api.normalizeButtonText(null), '');
});

test('isDeniedText: お金が絡む文字を拒否する', () => {
  assert.equal(api.isDeniedText('購入する'), true);
  assert.equal(api.isDeniedText('ポイントを使う'), true);
  assert.equal(api.isDeniedText('100円で買う'), true);
  assert.equal(api.isDeniedText('受け取る'), false);
  assert.equal(api.isDeniedText('次へ'), false);
});

test('isBlockedGacha: ガチャ系は無料／チケット以外を止める', () => {
  assert.equal(api.isBlockedGacha('ガチャを引く'), true);
  assert.equal(api.isBlockedGacha('無料ガチャ'), false);
  assert.equal(api.isBlockedGacha('チケットで引く'), false);
  assert.equal(api.isBlockedGacha('受け取る'), false);
});

test('matchPlayRule: 優先順ルールとラベル', () => {
  assert.equal(api.matchPlayRule('閉じる').label, 'ダイアログを閉じる');
  assert.equal(api.matchPlayRule('OK').label, 'ダイアログを閉じる');
  assert.equal(api.matchPlayRule('確認').label, 'ダイアログを閉じる');
  assert.equal(api.matchPlayRule('一括受取').label, '報酬を受け取る');
  assert.equal(api.matchPlayRule('オート').label, 'オートを押す');
  assert.equal(api.matchPlayRule('AUTO').label, 'オートを押す');
  assert.equal(api.matchPlayRule('スキップ').label, 'スキップする');
  assert.equal(api.matchPlayRule('出撃する').label, '次へ進む');
  assert.equal(api.matchPlayRule('関係ない文字'), null);
});

test('matchPlayRule: 「閉じる」を含んでも完全一致でなければ1番目のルールに当たらない', () => {
  // 1番目のルールは ^...$ の完全一致。部分一致の「受け取る」が優先される
  assert.equal(api.matchPlayRule('受け取って閉じる').label, '報酬を受け取る');
});

test('whitelistSet: 1行に1つの集合', () => {
  api.setSettings({ whitelist: '受け取る\n 出撃 \n\n' });
  const set = api.whitelistSet();
  assert.deepEqual([...set].sort(), ['出撃', '受け取る']);
});

test('domSignature: 同じ本文では同じ署名、違えば変わる', () => {
  state.body.innerText = 'あ'.repeat(100);
  const a = api.domSignature();
  assert.equal(api.domSignature(), a);
  state.body.innerText = 'い'.repeat(100);
  assert.notEqual(api.domSignature(), a);
  state.body.innerText = '';
  assert.equal(api.domSignature(), '0:0');
});

test('grayArray: 明るさ (3R+6G+B)/10 と色味 (R-B)', () => {
  const fakeCanvas = {
    width: 2,
    height: 1,
    getContext: () => ({
      getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) }),
    }),
  };
  const { g, c } = api.grayArray(fakeCanvas);
  assert.equal(g[0], 76);   // (255*3 + 0 + 0) / 10 = 76.5 → 切り捨て
  assert.equal(c[0], 255);  // 255 - 0
  assert.equal(g[1], 25);   // (0 + 0 + 255) / 10 = 25.5 → 切り捨て
  assert.equal(c[1], -255); // 0 - 255
});

test('meanAbsScore: 完全一致は 0、明るさ差は 0.7 倍、色味差は 0.3 倍', () => {
  const frame = { g: new Uint8Array(16).fill(100), c: new Int16Array(16).fill(0) };
  const same = { g: new Uint8Array(4).fill(100), c: new Int16Array(4).fill(0) };
  assert.equal(api.meanAbsScore(frame, same, 4, 2, 2, 0, 0), 0);
  const brighter = { g: new Uint8Array(4).fill(110), c: new Int16Array(4).fill(0) };
  assert.equal(api.meanAbsScore(frame, brighter, 4, 2, 2, 0, 0), 7);
  const redder = { g: new Uint8Array(4).fill(100), c: new Int16Array(4).fill(10) };
  assert.equal(api.meanAbsScore(frame, redder, 4, 2, 2, 0, 0), 3);
});
