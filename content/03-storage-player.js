'use strict';
// ========================================
// 💾 本体3: 設定の保存・読み込み / 🎮 操作担当フレーム
// ========================================
// 設定は chrome.storage.local のキー mpaSettings に保存され、全フレームで
// 共有される。操作担当フレームは、ゲーム画面（canvas）のあるフレームで
// モードごとの自動操作（会話送り・周回・シナリオ再生・画像マッチング）を担う。
// ========================================

// ----------------------------------------
// 💾 設定の保存・読み込み
// ----------------------------------------

// 💾 設定をストレージへ保存する
function saveSettings() {
  try { chrome.storage.local.set({ mpaSettings: settings }); } catch (e) { /* noop */ }
}

// 💾 設定をストレージから読み込む（既定値とマージするので、項目追加に強い）
function loadSettings(done) {
  try {
    chrome.storage.local.get('mpaSettings', (res) => {
      if (res && res.mpaSettings) settings = { ...DEFAULT_SETTINGS, ...res.mpaSettings };
      refreshTemplateImages();
      done();
    });
  } catch (e) { done(); }
}

// 🔄 他フレームでの設定変更をこのフレームにも反映する
try {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.mpaSettings && changes.mpaSettings.newValue) {
      settings = { ...DEFAULT_SETTINGS, ...changes.mpaSettings.newValue };
      refreshTemplateImages();
    }
  });
} catch (e) { /* noop */ }

// ----------------------------------------
// 🎬 シナリオ再生の補助
// ----------------------------------------

// 🕐 シナリオの1手の待ち時間を決める（既定800ms、上限60秒）
function clampScenarioDelay(delayMs) {
  return Math.min(delayMs || 800, 60000);
}

// 🎬 再生対象のシナリオを名前で探す（無ければ null）
function findActiveScenario() {
  return (settings.scenarios || []).find((s) => s.name === settings.activeScenario) || null;
}

// ========================================
// 🎮 操作担当フレーム（canvas があるフレーム）
// ========================================
function runPlayerFrame() {
  let lastHash = null;             // 前回見た画面ハッシュ
  let lastChangeAt = Date.now();   // 画面が最後に変化した時刻
  // 📝 行き詰まり検知の状態
  let actionHash = null;           // 操作直後の画面ハッシュ
  let actionPendingAt = 0;         // 操作の効果を確認待ちにした時刻
  let noChangeActions = 0;         // 画面が変わらなかった操作の連続回数
  // 📝 シナリオ再生の状態
  let scenName = '';
  let scenIdx = 0;
  let scenWaitUntil = 0;
  let scenDone = false;
  let lastMatchAt = 0;             // 画像マッチングを最後に実行した時刻

  // 📝 操作したことを行き詰まり判定用に控える
  function noteAction() {
    actionHash = lastHash;
    actionPendingAt = Date.now();
  }

  setInterval(() => {
    if (!settings.running) return;
    const st = canvasState();
    if (!st) return;
    // 🖼️ 画面が変化したら見張り担当へ知らせる
    if (lastHash !== null && st.hash !== lastHash) {
      lastChangeAt = Date.now();
      postToTop({ type: 'mpa-activity' });
    }
    lastHash = st.hash;
    const now = Date.now();

    // 🖥️ 行き詰まり判定: 操作したのに画面が変わらない回数を数える
    if (actionPendingAt && now - actionPendingAt >= 2500) {
      if (lastHash === actionHash) {
        noChangeActions += 1;
        if (settings.stuckLimit > 0 && noChangeActions >= settings.stuckLimit) {
          noChangeActions = 0;
          postToTop({ type: 'mpa-stuck', msg: '操作しても画面が変わりません' });
        }
      } else {
        noChangeActions = 0;
      }
      actionPendingAt = 0;
    }

    if (!inAllowWindow()) return;

    // 🎬 シナリオ再生モード
    if (settings.mode === 'scenario') {
      const scen = findActiveScenario();
      if (!scen) return;
      if (scenName !== scen.name) {
        scenName = scen.name;
        scenIdx = 0;
        scenWaitUntil = 0;
        scenDone = false;
      }
      if (scenDone) return;
      const step = scen.steps[scenIdx];
      if (!step) {
        if (settings.scenarioLoop) {
          scenIdx = 0;
          scenWaitUntil = now + 3000;
          postToTop({ type: 'mpa-action', msg: `シナリオ「${scen.name}」を繰り返します` });
        } else {
          scenDone = true;
          postToTop({ type: 'mpa-scenario-done', name: scen.name });
        }
        return;
      }
      if (!scenWaitUntil) {
        scenWaitUntil = now + clampScenarioDelay(step.delayMs);
        return;
      }
      if (now < scenWaitUntil) return;
      if (step.type === 'key') {
        if (step.key === 'enter') dispatchKey('Enter', 'Enter');
        else dispatchKey(' ', 'Space');
      } else {
        clickAtPercent({ x: step.x, y: step.y });
      }
      noteAction();
      scenIdx += 1;
      scenWaitUntil = 0;
      return;
    }

    if (settings.mode === 'play') {
      // 🖼️ 画像マッチングは3秒に1回だけ実行する（負荷対策）
      let matched = false;
      if (now - lastMatchAt >= 3000) {
        lastMatchAt = now;
        matched = matchTemplates();
      }
      if (matched) noteAction();
      // 🎯 ボタンが無く画面が静止していたら会話送り
      if (!matched
        && !st.blank
        && now - lastChangeAt >= settings.settleSec * 1000
        && now - lastHunterActionAt >= settings.settleSec * 1000) {
        doAdvance();
        noteAction();
      }
    } else if (settings.mode === 'advance') {
      // ▶️ 進行クリック: 静止したら登録ポイントを押す
      if (!st.blank && now - lastChangeAt >= settings.settleSec * 1000) {
        doAdvance();
        noteAction();
      }
    } else if (settings.mode === 'repeat') {
      // 🔁 繰り返しクリック: 登録ポイントを順番に押し続ける
      if (now - lastClickAt >= jitterMs(settings.intervalSec * 1000) && settings.points.length > 0) {
        clickAtPercent(settings.points[pointIndex % settings.points.length]);
        pointIndex += 1;
      }
    }
    // 📝 'watch'（見張りのみ）ではこのフレームは何もしない
  }, TICK_MS);

  // 🏷️ 画面左下の状態バッジ
  const badge = document.createElement('div');
  badge.id = 'mpa-badge';
  badge.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;'
    + 'background:rgba(20,20,30,.8);color:#fff;font-size:11px;font-family:sans-serif;'
    + 'padding:4px 8px;border-radius:6px;pointer-events:none;';
  badge.textContent = '🤖 自動化アシスタント待機中';
  document.documentElement.appendChild(badge);
  setInterval(() => {
    badge.textContent = settings.running
      ? `🤖 自動化中（${settings.mode}） Escで停止`
      : '🤖 自動化アシスタント待機中';
  }, TICK_MS);
}
