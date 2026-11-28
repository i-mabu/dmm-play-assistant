'use strict';
// 🧪 manifest.json の意味論テスト（権限・マッチパターン・ファイル構成）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, CONTENT_FILES } = require('./harness');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

test('manifest: MV3 でバージョンは 1.0.0', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.name, 'DMMプレイ自動化アシスタント（単一タブ）');
  assert.ok(manifest.description.includes('お金が絡むボタンは押しません'));
});

test('manifest: 権限は storage / notifications / scripting の3つ', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['notifications', 'scripting', 'storage']);
});

test('manifest: host_permissions はプレイドメイン2つ', () => {
  assert.deepEqual(manifest.host_permissions, [
    'https://play.games.dmm.com/*',
    'https://play.games.dmm.co.jp/*',
  ]);
});

test('manifest: optional_host_permissions は全サイト（追加ドメイン用）', () => {
  assert.deepEqual(manifest.optional_host_permissions, ['*://*/*']);
});

test('manifest: content_scripts のマッチと実行条件', () => {
  assert.equal(manifest.content_scripts.length, 1);
  const cs = manifest.content_scripts[0];
  assert.deepEqual(cs.matches, [
    'https://play.games.dmm.com/*',
    'https://play.games.dmm.co.jp/*',
    'https://*.dmm.com/*',
    'https://*.dmm.co.jp/*',
  ]);
  assert.equal(cs.all_frames, true);
  assert.equal(cs.run_at, 'document_idle');
  assert.deepEqual(cs.js, CONTENT_FILES);
});

test('manifest: サービスワーカーとアイコン', () => {
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.deepEqual(manifest.icons, { 128: 'icon.png' });
});
