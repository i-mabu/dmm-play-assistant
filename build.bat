@echo off
rem DMMプレイ自動化アシスタントの一括ビルド（構文チェック＋テスト＋パッケージ）。
setlocal
cd /d %~dp0

echo 構文チェックを実行します...
node tools\check.js
if errorlevel 1 exit /b 1

echo テストを実行します...
node --test
if errorlevel 1 exit /b 1

echo パッケージを作成します...
node tools\package.js
if errorlevel 1 exit /b 1

echo.
echo 成果物: %CD%\dist\dmm-play-assistant
echo 配布用: %CD%\dist\dmm-play-assistant.zip
endlocal
