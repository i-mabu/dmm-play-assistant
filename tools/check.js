'use strict';
// ========================================
// 🔍 構文チェックと manifest の整合性確認
// ========================================
// 拡張機能の全 JavaScript ファイルを構文チェックし、manifest.json が
// 参照するファイル（サービスワーカー / content_scripts / アイコン）が
// 実在することと、バージョン表記の一致を確認する。
// ========================================

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function fail(message) {
  console.error(`check: ${message}`);
  process.exit(1);
}

// 📄 manifest を読み込む
const manifestPath = path.join(ROOT, 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  fail(`manifest.json を読めません: ${e.message}`);
}
if (manifest.manifest_version !== 3) fail('manifest_version は 3 でなければなりません');

// 📦 package.json とのバージョン一致
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version) {
  fail(`バージョン不一致: package.json=${pkg.version} / manifest.json=${manifest.version}`);
}

// 📁 manifest が参照するファイルの実在確認
const referenced = [];
if (manifest.background && manifest.background.service_worker) {
  referenced.push(manifest.background.service_worker);
}
for (const cs of manifest.content_scripts || []) {
  for (const js of cs.js || []) referenced.push(js);
}
for (const p of Object.values(manifest.icons || {})) referenced.push(p);
for (const rel of referenced) {
  if (!fs.existsSync(path.join(ROOT, rel))) fail(`manifest が参照するファイルがありません: ${rel}`);
}

// 🔍 全 JavaScript ファイルの構文チェック
const targets = new Set(referenced.filter((f) => f.endsWith('.js')));
for (const dir of ['tools', 'tests']) {
  const d = path.join(ROOT, dir);
  if (fs.existsSync(d)) {
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith('.js')) targets.add(path.join(dir, f));
    }
  }
}
for (const rel of targets) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
  } catch (e) {
    fail(`構文エラー: ${rel}\n${e.stderr ? e.stderr.toString() : e.message}`);
  }
}

console.log(`check: OK（対象 ${targets.size} ファイル、manifest バージョン ${manifest.version}）`);
