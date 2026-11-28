'use strict';
// ========================================
// ⚙️ DMMプレイ自動化アシスタント（単一タブ） - サービスワーカー
// ========================================
// 役割:
//   - 表示中タブのスクリーンショット取得（mpa-capture）
//   - デスクトップ通知（mpa-notify）
//   - 追加ドメイン（別ドメインの iframe で動くゲーム）への
//     コンテンツスクリプト登録（mpa-register-extra）
// ========================================

// 📜 追加ドメインへ登録するコンテンツスクリプト（manifest と同じ並び）
const CONTENT_SCRIPT_FILES = [
  'content/01-settings-utils.js',
  'content/02-dom-hunter.js',
  'content/03-storage-player.js',
  'content/04-top-frame.js',
  'content/05-recorder-main.js',
];

// 🔗 ホスト指定を content_scripts 用のマッチパターンへ変換する
//   - "https://example.com" のような URL 形式 → "https://example.com/*"
//   - "*.example.com" のようなホスト形式     → "*://*.example.com/*"
function toMatchPattern(host) {
  if (host.includes('://')) {
    return host.endsWith('/*') ? host : `${host.replace(/\/*$/, '')}/*`;
  }
  return `*://${host}/*`;
}

// 🌐 追加ドメインへコンテンツスクリプトを登録し直す
async function registerExtraDomains(hosts) {
  const id = 'mpa-extra';
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch (e) { /* 未登録なら無視 */ }
  const matches = (hosts || []).map(toMatchPattern).filter(Boolean);
  if (!matches.length) return;
  try {
    await chrome.scripting.registerContentScripts([{
      id,
      js: CONTENT_SCRIPT_FILES,
      matches,
      allFrames: true,
      runAt: 'document_idle',
    }]);
  } catch (e) { /* パターン不正などは無視 */ }
}

// 💾 保存済みの追加ドメインを読み直して再登録する
function reregisterFromStorage() {
  try {
    chrome.storage.local.get('mpaSettings', (res) => {
      const saved = (res && res.mpaSettings) || {};
      const hosts = (saved.extraDomains || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      registerExtraDomains(hosts);
    });
  } catch (e) { /* noop */ }
}
chrome.runtime.onStartup.addListener(reregisterFromStorage);
chrome.runtime.onInstalled.addListener(reregisterFromStorage);

// ✉️ コンテンツスクリプトからの依頼を受ける
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;

  // 📷 表示中タブのスクリーンショット
  if (msg.type === 'mpa-capture') {
    if (!sender.tab) {
      sendResponse({ ok: false });
      return false;
    }
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
      const err = chrome.runtime.lastError;
      sendResponse({ ok: !!dataUrl, dataUrl: dataUrl || null, error: err ? err.message : null });
    });
    return true; // 非同期で応答する
  }

  // 🔔 デスクトップ通知
  if (msg.type === 'mpa-notify') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'DMMプレイ自動化アシスタント',
      message: msg.message || '',
    });
    sendResponse({ ok: true });
    return false;
  }

  // 🌐 追加ドメインの登録し直し
  if (msg.type === 'mpa-register-extra') {
    registerExtraDomains(msg.hosts || []);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
