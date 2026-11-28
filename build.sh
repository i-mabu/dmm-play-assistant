#!/bin/bash
# DMMプレイ自動化アシスタントの一括ビルド（構文チェック＋テスト＋パッケージ）。
# 成果物（読み込み用フォルダと zip）のパスを表示する。
set -e
cd "$(dirname "$0")"

echo "構文チェックを実行します..."
node tools/check.js

echo "テストを実行します..."
node --test

echo "パッケージを作成します..."
node tools/package.js

echo ""
echo "成果物: $(pwd)/dist/dmm-play-assistant （Chrome の「パッケージ化されていない拡張機能を読み込む」で指定）"
echo "配布用: $(pwd)/dist/dmm-play-assistant.zip"
