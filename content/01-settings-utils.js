'use strict';
// ========================================
// 🤖 DMMプレイ自動化アシスタント（単一タブ） v1.0.0
// ========================================
//
// 対象: 開いている1つのプレイページだけ。タブは増やさない。
//
// プレイ自動化（メイン機能）:
//   - 画面上のボタン（DOM）を探して優先順に押す: ダイアログを閉じる → 報酬を受け取る
//     → オート → スキップ → 次へ/スタート等
//   - テンプレート画像マッチング: 登録したボタンの画像をゲーム画面(canvas)から探して押す
//   - ボタンが無く画面が静止していたら会話送り（クリック or Space/Enter キー送信）
//   - お金が絡むボタン（購入/チャージ/課金/有償…）は絶対に押さない。
//     ガチャ系は「無料」「チケット」を含む場合だけ押す
//
// その他の機能:
//   - 読み込み見張り: 進んでいる間は再読み込みしない。一定時間無変化なら1回だけ再読み込み
//   - 繰り返しクリック（周回）/ 進行クリック モード
//   - 1タブ巡回: 同じタブのまま URL リストを順に開いて回る
//   - 時刻スケジュール（開始/停止）、稼働時間帯の制限
//   - 危険ワード（購入確認/メンテナンス/通信エラー等）が出たら即停止して通知
//   - クリック間隔・位置のゆらぎ、長押し、1日のクリック上限
//   - ホワイトリスト方式（登録した文字のボタンだけ押す厳格モード）
//   - スクリーンショット保存、デスクトップ通知
//   - セッション記録と Muse への報告コピー / JSON保存
//
// 安全装置: Escキーで即停止 / 最大稼働時間で自動停止 / 再読み込み回数に上限。
//
// このファイル（本体1）: 設定・定数、小物ユーティリティ、画面（canvas）状態、
// クリック／キー送信を担当する。content_scripts の5ファイルは同一スコープで
// 順に実行されるため、ここで定義した名前は後続ファイルから使える。
// ========================================

// 💾 既定設定（ストレージのキー mpaSettings にこの形で保存される）
const DEFAULT_SETTINGS = {
  running: false,
  mode: 'play',               // 'play' | 'watch' | 'advance' | 'repeat' | 'scenario'
  settleSec: 4,               // 静止判定（秒）
  intervalSec: 2,             // 繰り返しクリックの間隔（秒）
  stallMin: 5,                // 見張り: この分数まったく変化が無ければ再読み込み
  maxRunMin: 60,              // 最大稼働時間（分）
  points: [{ x: 50, y: 78 }], // クリック位置（ゲーム画面に対する %）
  advanceMethod: 'click',     // 会話送り: 'click' | 'space' | 'enter'
  holdMs: 60,                 // クリックの長押し時間（ミリ秒）
  jitter: true,               // クリック位置・間隔にゆらぎを持たせる
  strictWhitelist: false,     // 登録した文字のボタンだけ押す
  whitelist: '',              // 1行に1つ
  dangerStop: true,           // 危険ワードで即停止
  dailyClickCap: 0,           // 1日のクリック上限（0=無制限）
  allowFrom: '',              // 稼働時間帯 'HH:MM'（空=制限なし）
  allowTo: '',
  scheduleStart: '',          // 自動開始 'HH:MM'（空=なし）
  scheduleStop: '',           // 自動停止 'HH:MM'（空=なし）
  patrol: false,              // 1タブ巡回を使う
  patrolMin: 3,               // 1タイトルあたりの滞在（分）
  patrolUrls: '',             // 1行に1URL
  shotOnStop: false,          // 停止時にスクリーンショットを保存
  templates: [],              // [{name, dataUrl, wPct}]
  stuckLimit: 3,              // 行き詰まり検知: 画面が変わらないまま何回操作したら止めるか（0=無効）
  scenarios: [],              // [{name, url, steps:[{type:'click'|'key', x, y, key, delayMs}]}]
  activeScenario: '',         // 再生するシナリオ名
  scenarioLoop: false,        // シナリオを繰り返す
  profiles: {},               // URLキー -> タイトル別設定
  tplThreshold: 26,           // 画像マッチングのしきい値（小さいほど厳密）
  dangerWordsText: '',        // 危険ワード（1行に1つ。空なら既定リスト）
  extraDomains: '',           // 追加で対象にするドメイン（1行に1つ。例: *.game-example.com）
};

const MAX_RELOADS = 3;  // 1セッションの自動再読み込み上限
const TICK_MS = 1000;   // 各ループの基本間隔（ミリ秒）
// ⚠️ 危険ワードの既定リスト（ダイアログ内では全て、本文では強いワードだけを見る）
const DANGER_WORDS = ['購入確認', '購入しますか', 'メンテナンス中', '通信エラー', 'エラーが発生', 'セッションが切れました'];

// 📝 実行中の状態（保存されない作業用変数）
let settings = { ...DEFAULT_SETTINGS };
let startedAt = 0;          // 稼働開始時刻（エポックミリ秒。0=未開始）
let lastClickAt = 0;        // 最後にクリック／キーを送った時刻
let pointIndex = 0;         // 繰り返しクリックで次に押すポイントの番号
let registeringPoint = false; // ポイント登録待ちかどうか

// ----------------------------------------
// 🔧 小物ユーティリティ
// ----------------------------------------

// 📄 テキストを「1行に1項目」として読み、空行と前後の空白を取り除く
function parseLines(text) {
  return (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// 📐 % 座標を 0〜100 の範囲へ収める
function clampPct(v) {
  return Math.min(100, Math.max(0, v));
}

// 📐 基準矩形に対する点の位置を %（整数）で返す
function pctOfPoint(client, rectStart, rectSize) {
  if (!(rectSize > 0)) return 0;
  return clampPct(Math.round(((client - rectStart) / rectSize) * 100));
}

// 🎲 % 座標にゆらぎを加えて 0〜100 に収める
function jitterPct(v, range) {
  if (!settings.jitter) return v;
  return clampPct(v + (Math.random() * 2 - 1) * range);
}

// 🎲 ミリ秒にゆらぎを加える（0.85倍〜1.30倍）
function jitterMs(ms) {
  if (!settings.jitter) return ms;
  return ms * (0.85 + Math.random() * 0.45);
}

// 🕐 Date を HH:MM 形式の文字列にする
function hhmmOf(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}`;
}

// 🕐 現在時刻を HH:MM 形式で返す
function nowHHMM() {
  return hhmmOf(new Date());
}

// 🕐 時刻 t が時間帯 [from, to] の内側か判定する（日をまたぐ時間帯にも対応）
function inWindow(from, to, t) {
  if (!from || !to) return true;
  if (from <= to) return t >= from && t <= to;
  return t >= from || t <= to;
}

// 🕐 稼働時間帯の内外を判定する
function inAllowWindow() {
  return inWindow(settings.allowFrom, settings.allowTo, nowHHMM());
}

// 🔔 デスクトップ通知を送る（サービスワーカー経由）
function notify(message) {
  try { chrome.runtime.sendMessage({ type: 'mpa-notify', message }); } catch (e) { /* noop */ }
}

// 📷 表示中タブのスクリーンショットを取得する（dataUrl か null を返す）
function requestCapture() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'mpa-capture' }, (res) => {
        resolve(res && res.ok ? res.dataUrl : null);
      });
    } catch (e) { resolve(null); }
  });
}

// ✉️ 最上位フレームへ通知メッセージを送る
function postToTop(data) {
  try { window.top.postMessage(data, '*'); } catch (e) { /* noop */ }
}

// ----------------------------------------
// 🖼️ 画面（canvas）の状態
// ----------------------------------------

// 🖼️ 変化検知用の縮小サンプリング先（32x18）
const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = 32;
sampleCanvas.height = 18;

// 🖼️ 画面上で最も大きい canvas を探す
function largestCanvas() {
  let best = null;
  let bestArea = 0;
  document.querySelectorAll('canvas').forEach((c) => {
    const r = c.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) { bestArea = area; best = c; }
  });
  return best;
}

// 🖼️ ゲーム画面の要素（canvas、無ければ iframe）を返す
function gameAreaEl() {
  return largestCanvas() || document.querySelector('iframe');
}

// 🎮 このフレームが操作対象のプレイヤーフレームか判定する
//    （canvas がビューポートの 35% 以上を占めていれば対象）
function isPlayerFrame() {
  const c = largestCanvas();
  if (!c) return false;
  const r = c.getBoundingClientRect();
  const viewArea = window.innerWidth * window.innerHeight;
  return viewArea > 0 && (r.width * r.height) / viewArea >= 0.35;
}

// 🖼️ canvas を縮小サンプリングして画面の変化を数値化する
//    戻り値: { hash, blank }（blank は真っ白／真っ黒に近い状態）
function canvasState() {
  const c = largestCanvas();
  if (!c) return null;
  try {
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(c, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const data = ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    let hash = 0;
    let sum = 0;
    let n = 0;
    // 📝 4ピクセルに1つ、R成分だけを拾って軽く済ませる
    for (let i = 0; i < data.length; i += 16) {
      hash = ((hash * 31) + data[i]) | 0;
      sum += data[i];
      n += 1;
    }
    const mean = n ? sum / n : 0;
    return { hash, blank: mean > 245 || mean < 8 };
  } catch (e) {
    return null; // セキュリティ制限でピクセルが読めない場合
  }
}

// ----------------------------------------
// 🖱️ クリック / キー送信
// ----------------------------------------

// 🖱️ 指定座標へポインター／マウスイベントを送る（長押し対応）
function dispatchClick(target, x, y, holdMs) {
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
  try {
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    setTimeout(() => {
      try {
        target.dispatchEvent(new PointerEvent('pointerup', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.dispatchEvent(new MouseEvent('click', opts));
      } catch (e) { /* noop */ }
    }, Math.max(0, holdMs || 0));
    postToTop({ type: 'mpa-click' });
  } catch (e) { /* noop */ }
  lastClickAt = Date.now();
}

// 🖱️ ゲーム画面に対する % 座標をクリックする
function clickAtPercent(p) {
  const px = jitterPct(p.x, 1.5);
  const py = jitterPct(p.y, 1.5);
  const c = largestCanvas();
  let x;
  let y;
  let target;
  if (c) {
    const r = c.getBoundingClientRect();
    x = r.left + (r.width * px) / 100;
    y = r.top + (r.height * py) / 100;
    target = c;
  } else {
    x = (window.innerWidth * px) / 100;
    y = (window.innerHeight * py) / 100;
    target = document.elementFromPoint(x, y) || document.body;
  }
  dispatchClick(target, x, y, settings.holdMs);
}

// ⌨️ 指定キーの keydown／keyup を送る（対象要素と document の両方へ）
function dispatchKey(key, code) {
  const target = largestCanvas() || document.body;
  const opts = { bubbles: true, cancelable: true, key, code, view: window };
  try {
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
    document.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.dispatchEvent(new KeyboardEvent('keyup', opts));
  } catch (e) { /* noop */ }
  lastClickAt = Date.now();
  postToTop({ type: 'mpa-click' });
}

// ⌨️ 会話送り用のキー（Space／Enter）を送る
function sendAdvanceKey() {
  if (settings.advanceMethod === 'enter') dispatchKey('Enter', 'Enter');
  else dispatchKey(' ', 'Space');
}

// ▶️ 設定に応じてクリックかキーで会話を進める
function doAdvance() {
  if (settings.advanceMethod === 'click') {
    if (settings.points.length > 0) clickAtPercent(settings.points[0]);
  } else {
    sendAdvanceKey();
  }
}
