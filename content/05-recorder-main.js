'use strict';
// ========================================
// 🎬 本体5: 操作レコーダー / 🛑 Esc停止 / 🚀 起動
// ========================================
// 記録中フラグ（mpaRecording）がある間、ユーザーの手動クリックと
// Space/Enter を、ゲーム画面に対する % 座標と時刻で記録する。
// 自動操作中（running）のクリックは記録しない。
// ========================================

// 📐 クリック位置をゲーム画面（無ければ画面全体）に対する % 座標へ変換する
function pointFromEvent(ev, area) {
  if (area) {
    const r = area.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return {
        x: pctOfPoint(ev.clientX, r.left, r.width),
        y: pctOfPoint(ev.clientY, r.top, r.height),
      };
    }
    return { x: 50, y: 78 };
  }
  return {
    x: pctOfPoint(ev.clientX, 0, window.innerWidth),
    y: pctOfPoint(ev.clientY, 0, window.innerHeight),
  };
}

// 🎬 記録バッファへ操作1件を追加する
function appendRecordStep(step) {
  try {
    chrome.storage.local.get('mpaRecordBuffer', (res) => {
      const buf = res.mpaRecordBuffer || [];
      buf.push(step);
      chrome.storage.local.set({ mpaRecordBuffer: buf });
    });
  } catch (e) { /* noop */ }
}

// 🎬 記録中だけコールバックを実行する
function withRecording(fn) {
  if (settings.running) return;
  try {
    chrome.storage.local.get('mpaRecording', (res) => {
      if (res && res.mpaRecording) fn(res.mpaRecording);
    });
  } catch (e) { /* noop */ }
}

// 🖱️ 手動クリックの記録（パネルとバッジ上の操作は除く）
document.addEventListener('click', (ev) => {
  if (ev.target && ev.target.closest
    && (ev.target.closest('#mpa-panel') || ev.target.closest('#mpa-badge'))) return;
  withRecording(() => {
    const p = pointFromEvent(ev, gameAreaEl());
    appendRecordStep({ type: 'click', x: p.x, y: p.y, t: Date.now() });
  });
}, true);

// ⌨️ Space/Enter の記録（入力欄の中とパネル上の操作は除く）
document.addEventListener('keydown', (ev) => {
  if (ev.key !== ' ' && ev.key !== 'Enter') return;
  const tag = (ev.target && ev.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (ev.target && ev.target.closest && ev.target.closest('#mpa-panel')) return;
  withRecording(() => {
    appendRecordStep({ type: 'key', key: ev.key === 'Enter' ? 'enter' : 'space', t: Date.now() });
  });
}, true);

// ----------------------------------------
// 🛑 共通: Escで即停止
// ----------------------------------------
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && settings.running) {
    settings.running = false;
    saveSettings();
    try {
      chrome.runtime.sendMessage({ type: 'mpa-notify', message: 'Escキーで停止しました' });
    } catch (e) { /* noop */ }
  }
});

// ----------------------------------------
// 🚀 起動
// ----------------------------------------
// 設定を読み込み、フレームの役割に応じて担当を起動する。
// DOMボタン探索は全フレームで動かす。
loadSettings(() => {
  if (window === window.top) runTopFrame();
  if (isPlayerFrame()) runPlayerFrame();
  runDomHunter();
});
