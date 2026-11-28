'use strict';
// 🧪 サービスワーカー（background.js）のテスト
//    マッチパターン変換、追加ドメイン登録、メッセージ応答を確認する
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, plain } = require('./harness');

test('toMatchPattern: ホスト形式は *:// を付ける', () => {
  const { api } = loadBackground();
  assert.equal(api.toMatchPattern('*.example.com'), '*://*.example.com/*');
  assert.equal(api.toMatchPattern('example.com'), '*://example.com/*');
});

test('toMatchPattern: URL形式は末尾に /* を補う', () => {
  const { api } = loadBackground();
  assert.equal(api.toMatchPattern('https://example.com'), 'https://example.com/*');
  assert.equal(api.toMatchPattern('https://example.com/'), 'https://example.com/*');
  assert.equal(api.toMatchPattern('https://example.com/*'), 'https://example.com/*');
});

test('registerExtraDomains: 5つの content ファイルを登録する', async () => {
  const { api, calls } = loadBackground();
  await api.registerExtraDomains(['*.example.com', 'https://foo.jp']);
  assert.deepEqual(plain(calls.unregistered), [['mpa-extra']]);
  assert.equal(calls.registered.length, 1);
  const def = calls.registered[0][0];
  assert.equal(def.id, 'mpa-extra');
  assert.deepEqual(plain(def.matches), ['*://*.example.com/*', 'https://foo.jp/*']);
  assert.deepEqual(plain(def.js), [
    'content/01-settings-utils.js',
    'content/02-dom-hunter.js',
    'content/03-storage-player.js',
    'content/04-top-frame.js',
    'content/05-recorder-main.js',
  ]);
  assert.equal(def.allFrames, true);
  assert.equal(def.runAt, 'document_idle');
});

test('registerExtraDomains: 空なら登録しない（解除だけ行う）', async () => {
  const { api, calls } = loadBackground();
  await api.registerExtraDomains([]);
  assert.equal(calls.registered.length, 0);
  assert.deepEqual(plain(calls.unregistered), [['mpa-extra']]);
});

test('起動時: 保存済みの追加ドメインを再登録する', async () => {
  const { calls } = loadBackground({ extraDomains: '*.saved.example.com\n' });
  assert.equal(typeof calls.listeners.startup, 'function');
  calls.listeners.startup();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.registered.length, 1);
  assert.deepEqual(plain(calls.registered[0][0].matches), ['*://*.saved.example.com/*']);
});

test('mpa-notify: 通知を作って ok を返す', () => {
  const { calls } = loadBackground();
  let response = null;
  const keepAlive = calls.listeners.message(
    { type: 'mpa-notify', message: 'テスト通知' },
    {},
    (res) => { response = res; },
  );
  assert.equal(keepAlive, false);
  assert.deepEqual(plain(response), { ok: true });
  assert.equal(calls.notifications.length, 1);
  assert.equal(calls.notifications[0].type, 'basic');
  assert.equal(calls.notifications[0].title, 'DMMプレイ自動化アシスタント');
  assert.equal(calls.notifications[0].message, 'テスト通知');
  assert.equal(calls.notifications[0].iconUrl, 'icon.png');
});

test('mpa-capture: タブが無ければ失敗を返す', () => {
  const { calls } = loadBackground();
  let response = null;
  const keepAlive = calls.listeners.message(
    { type: 'mpa-capture' },
    {},
    (res) => { response = res; },
  );
  assert.equal(keepAlive, false);
  assert.deepEqual(plain(response), { ok: false });
});

test('mpa-capture: 表示中タブを撮影して dataUrl を返す', async () => {
  const { calls } = loadBackground();
  const response = await new Promise((resolve) => {
    const keepAlive = calls.listeners.message(
      { type: 'mpa-capture' },
      { tab: { windowId: 7 } },
      resolve,
    );
    assert.equal(keepAlive, true); // 非同期応答
  });
  assert.equal(response.ok, true);
  assert.equal(response.dataUrl, 'data:image/png;base64,xyz');
  assert.equal(response.error, null);
  assert.equal(calls.captures, 1);
});
