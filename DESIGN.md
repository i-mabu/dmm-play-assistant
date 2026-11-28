# DESIGN — DMMプレイ自動化アシスタント（単一タブ）

設計判断・パリティ棚卸し・既知の問題を記録する文書。
本リポジトリは旧版 v1.5.1 を、統一開発フロー（aegis-bot 標準）に沿って
ゼロから再実装したものである。再実装にあたっての正は旧版のローカルクローン
（コード・README・CHANGELOG）とし、挙動のパリティを最優先した。

## 1. アーキテクチャ

- Chrome 拡張機能（Manifest V3）。ビルド不要のプレーンな JavaScript。
- コンテンツスクリプトは `content/01` 〜 `05` の5ファイルが **同一スコープで
  manifest の記載順に実行** される。ファイル分割は責務ごと（設定・小物／
  DOM探索・画像／保存・操作フレーム／見張りフレーム／レコーダー・起動）。
  トップレベルの名前は5ファイルを通して一意でなければならない。
- サービスワーカー（`background.js`）は特権 API の窓口:
  スクリーンショット（`chrome.tabs.captureVisibleTab`）、デスクトップ通知、
  追加ドメインへの動的登録（`chrome.scripting`）。
- フレーム間の通信は `window.top.postMessage`（子 → 最上位）と
  `chrome.storage.local` の `mpaSettings` 共有（全フレーム）で行う。

### フレームの役割分担

| フレーム | 担当 |
|---|---|
| 最上位フレーム | パネル、見張り（再読み込み判定）、巡回、スケジュール、危険ワード検知、プロファイル適用、セッション記録 |
| プレイヤーフレーム（canvas が画面の35%以上） | モード別操作（会話送り・周回・シナリオ再生・画像マッチング）、状態バッジ |
| 全フレーム | DOMボタン探索（1.5秒間隔）、操作レコーダー、Esc停止 |

### ストレージキー（互換性のため変更禁止）

| 保存先 | キー | 内容 |
|---|---|---|
| chrome.storage.local | `mpaSettings` | 設定一式（既定値とマージして読む） |
| chrome.storage.local | `mpaRecording` | 記録中のシナリオ情報 {name, startedAt} |
| chrome.storage.local | `mpaRecordBuffer` | 記録中の操作列 |
| sessionStorage | `mpa-reloads:<pathname>` | 自動再読み込み回数 |
| sessionStorage | `mpa-log:<pathname>` | セッション記録 |
| localStorage | `mpa-daily` | 1日のクリック数 {date, count} |
| localStorage | `mpa-run-started` | 稼働開始時刻（復帰用） |
| localStorage | `mpa-patrol:<href>` | 巡回の滞在開始時刻 |

## 2. パリティ棚卸し（旧版 v1.5.1 → 再実装 v1.0.0）

### 維持したもの

| 領域 | 内容 |
|---|---|
| manifest | MV3、名前・説明文、権限（storage/notifications/scripting）、host_permissions 2件、optional_host_permissions `*://*/*`、content_scripts のマッチ4件・all_frames・document_idle・5ファイルの並び、アイコン 128 |
| 設定 | `DEFAULT_SETTINGS` の全33キーと既定値（単体テストで固定） |
| ストレージ | 上表の全キー名と値の形 |
| メッセージ | runtime: `mpa-capture` / `mpa-notify` / `mpa-register-extra`、postMessage: `mpa-click` / `mpa-activity` / `mpa-action` / `mpa-stuck` / `mpa-scenario-done` |
| DOM探索 | セレクタ、優先順ルール5件とラベル、拒否正規表現、ガチャ制限（無料／チケットのみ）、文字数上限40、表示・押下可能性の判定、1.5秒間隔 |
| 画像マッチング | 幅320pxへ縮小、グレースケール (3R+6G+B)/10 ＋色味 (R−B)、重み 0.7/0.3、2px サンプリング・3px ステップ、マルチスケール [1, 0.8, 1.25]、しきい値既定26、3秒間引き |
| 画面状態 | 32x18 サンプリング、4ピクセルに1つ R 成分のハッシュ、blank 判定（平均 >245 または <8） |
| 操作フレーム | モード分岐（play/advance/repeat/scenario/watch）、行き詰まり判定（2.5秒・上限回数）、シナリオ待ち時間（既定800ms・上限60秒）、ループ時3秒待ち |
| 見張り | 無変化で再読み込み（上限3回、sessionStorage で継続）、DOM変化はゲーム画面周辺のみ数える、リソース件数の変化も数える、最大稼働時間で停止 |
| 危険ワード | 既定6件、強いワード3件、ダイアログ内は全ワード・本文は強いワードのみ、5秒間隔、カスタム優先 |
| 巡回 | `mpa-patrol:` タイマー、滞在分数、次URLの決定（前方一致、末尾→先頭、未知→先頭） |
| スケジュール | HH:MM 一致で開始・停止 |
| プロファイル | 対象11項目、キー = origin + pathname、開いたときに自動適用 |
| 記録 | クリック（%座標）と Space/Enter、間隔は 0〜60秒に丸め、シナリオ {name, url, steps} として保存 |
| 報告 | 報告文の書式、JSON保存の形（tool 名・page・title・mode・回数・events）、ファイル名 `mpa-log.json`、スクショのファイル名 `mpa-shot-<tag>-<時刻>.png` |
| パネル | 全コントロールの id・ラベル・選択肢・説明文、読み取り時の丸め規則（settle≥1、maxRun≥5、しきい値 5〜80 など） |
| 安全装置 | Esc停止、最大稼働時間、再読み込み上限、1日のクリック上限、お金が絡むボタンの拒否 |

### 意図的に変えたもの

| # | 変更 | 理由 |
|---|---|---|
| 1 | バージョンを 1.5.1 → 1.0.0 にリセット（manifest・package.json・JSON保存の version） | 作り直しプログラムの統一ルール |
| 2 | **追加ドメイン登録の不具合を修正**: サービスワーカーが登録する js を、存在しない `content.js` から、実在する5ファイル（manifest と同じ並び）へ変更 | 旧版ではファイル分割（旧 v1.5.1 世代の整理）以降 `content.js` が存在せず、`registerContentScripts` が失敗して追加ドメイン機能が実質動作しなかった（例外は握りつぶされていた）。パネルからの登録・起動時の再登録の両方に効く |
| 3 | 残骸のクールダウンマップ（書き込みだけで読み手のない `hunterCooldown` / `tplCooldown` / `hunterLastSig`）を削除 | v1.5.1 でクールダウン判定自体が廃止済みで、書き込みは無意味だった。挙動の変更なし |
| 4 | 常に真になる条件（`now - lastClickAt >= 0`）を削除 | 挙動の変更なし（コードの意図を明確にするため） |
| 5 | 純粋な判定ロジックを名前付き関数へ切り出し（`inWindow`、`pctOfPoint`、`meanAbsScore`、`buildScenarioSteps`、`patrolNextUrl`、`bumpedDaily` など）。「1行に1つ」の解析は `parseLines` に統一 | 単体テスト可能にするため。呼び出し側の挙動は同一 |
| 6 | `sendAdvanceKey` の本体を `dispatchKey` の再利用に変更 | 重複していたイベント送信処理を1本化。送るイベント・順序は同一 |
| 7 | アイコンを新規に描画（濃紺の角丸スクエア＋再生三角形＋オレンジのドット、128x128 PNG）し、生成スクリプト `tools/gen-icon.js` を同梱 | 再実装では全ファイルを新規に起こす方針のため。役割（拡張機能アイコン 128）は同一 |
| 8 | テスト基盤を追加: Node 標準テストランナーで 49 件（旧版はテストなし）。実ファイルを vm 上で読み込んで検証する方式 | 統一開発フローの標準に合わせるため |
| 9 | ビルド基盤を追加: `tools/check.js`（構文＋manifest 整合性）、`tools/package.js`（dist フォルダ＋zip）、`build.sh` / `build.bat` | 旧版はフォルダをそのまま読み込む運用のみだった。リポジトリ直下のフォルダは従来どおりそのまま読み込める |

## 3. 既知の問題・制限

- DOM探索は文字として読める UI が対象。Canvas に描かれた文字は読めない（画像マッチングで代替）。
- ゲーム画面の canvas がセキュリティ制限で読めない場合、変化検知・画像マッチングが効かない。
- 別ドメインの iframe で動くゲームは、追加ドメイン登録と権限許可をしても、
  対象フレームで拡張機能が動けない構成ではクリック自動化が効かないことがある。
- パネルの表示同期（syncPanel / readPanel）と見張りループ全体は DOM 依存のため
  単体テストの対象外（テストは判定ロジック中心）。実ブラウザでの動作確認が必要。
- シナリオ再生・巡回・スケジュールはページを開いたままにしていることが前提。

## 4. テスト方針

- `tests/harness.js` が実ファイル（content 5本・background）を Node の vm で
  読み込み、ブラウザ環境をスタブで再現して関数を検証する。
- manifest の意味論（権限・マッチ・並び）、既定設定と既定リスト、ストレージキー名は
  テストで固定し、互換性を壊す変更を検出できるようにしている。
- vm 内で生成された配列・オブジェクトは `plain()` で変換してから deepEqual する
  （プロトタイプの違いによる誤検出を避けるため）。
