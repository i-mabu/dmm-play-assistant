'use strict';
// ========================================
// 📦 配布用パッケージの作成
// ========================================
// dist/dmm-play-assistant/ に、Chrome へ読み込める形の拡張機能一式
// （manifest.json / background.js / content/ / icon.png）を集め、
// 可能なら dist/dmm-play-assistant.zip も作る。
// zip コマンドが無い環境ではフォルダのみ作成して正常終了する。
// ========================================

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'dmm-play-assistant');

// 🧹 既存の成果物を消してから作り直す
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 📁 実行時に必要なファイルだけを集める
for (const name of ['manifest.json', 'background.js', 'icon.png']) {
  fs.copyFileSync(path.join(ROOT, name), path.join(OUT, name));
}
fs.cpSync(path.join(ROOT, 'content'), path.join(OUT, 'content'), { recursive: true });

// 🗜️ zip 化（zip コマンドがある場合のみ）
const zipPath = path.join(DIST, 'dmm-play-assistant.zip');
fs.rmSync(zipPath, { force: true });
try {
  execFileSync('zip', ['-qr', zipPath, 'dmm-play-assistant'], { cwd: DIST, stdio: 'pipe' });
  console.log(`package: ${zipPath} を作成しました`);
} catch (e) {
  console.log('package: zip コマンドが無いため zip は作成しませんでした（フォルダのみ）');
}
console.log(`package: ${OUT} を作成しました`);
