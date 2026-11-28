'use strict';
// ========================================
// 👀 本体4: 見張り担当（最上位フレーム）
// ========================================
// パネル表示、読み込み見張り（無変化時の再読み込み）、1タブ巡回、
// 時刻スケジュール、危険ワード検知、タイトル別プロファイル、
// セッション記録と Muse への報告を担当する。
// ========================================

// ⚠️ ページ本文でも検知する強い危険ワード（ダイアログ内は全ワードを見る）
const DANGER_STRONG = ['購入確認', '購入しますか', 'セッションが切れました'];

// 👤 タイトル別プロファイルで保存・適用する項目
const PROFILE_FIELDS = ['mode', 'settleSec', 'intervalSec', 'holdMs', 'advanceMethod', 'points', 'templates', 'strictWhitelist', 'whitelist', 'activeScenario', 'scenarioLoop'];

// 🕐 Date を HH:MM:SS 形式の文字列にする（セッション記録の時刻用）
function formatHMS(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

// ⚠️ 危険ワード一覧（カスタム設定があればそれを、無ければ既定リスト）を返す
function dangerWordList() {
  const custom = parseLines(settings.dangerWordsText || '');
  return custom.length ? custom : DANGER_WORDS;
}

// 🔢 保存済みの日次カウントから今日の回数を読む
function readDailyCount(raw, today) {
  try {
    const d = JSON.parse(raw || '{}');
    return d.date === today ? (d.count || 0) : 0;
  } catch (e) { return 0; }
}

// 🔢 今日のクリック回数を1増やした保存用オブジェクトを作る
function bumpedDaily(raw, today) {
  let d = {};
  try { d = JSON.parse(raw || '{}'); } catch (e) { d = {}; }
  const count = d.date === today ? (d.count || 0) + 1 : 1;
  return { date: today, count };
}

// 🎬 記録バッファからシナリオの手順を組み立てる（間隔は 0〜60秒に収める）
function buildScenarioSteps(recording, buffer) {
  const sorted = [...(buffer || [])].sort((a, b) => a.t - b.t);
  const steps = [];
  let prevT = recording.startedAt;
  for (const s of sorted) {
    steps.push({
      type: s.type,
      x: s.x,
      y: s.y,
      key: s.key,
      delayMs: Math.min(Math.max(s.t - prevT, 0), 60000),
    });
    prevT = s.t;
  }
  return steps;
}

// 🔁 巡回リストの中で、現在の URL の次に開く URL を返す
function patrolNextUrl(urls, href) {
  const idx = urls.findIndex((u) => href.startsWith(u));
  return urls[(idx + 1) % urls.length];
}

// 📋 セッション記録から Muse への報告文を作る
function buildReportText(info) {
  const lines = [];
  lines.push('');
  lines.push(`ページ: ${info.title} ${info.href}`);
  lines.push(`モード: ${info.mode} / クリック回数: ${info.clickCount} / 再読み込み: ${info.reloadCount}回`);
  lines.push('イベント:');
  info.events.forEach((e) => lines.push(`- ${e.time} ${e.msg}`));
  lines.push('→ Museへ: この内容を作業まとめアプリへ記録してください。');
  return lines.join('\n');
}

// ========================================
// 👀 見張り担当の本体（最上位フレームでのみ実行）
// ========================================
function runTopFrame() {
  let lastActivityAt = Date.now();
  const reloadKey = 'mpa-reloads:' + location.pathname;
  let reloadCount = parseInt(sessionStorage.getItem(reloadKey) || '0', 10) || 0;

  // ----------------------------------------
  // 📝 Muse 連携: セッション記録
  // ----------------------------------------
  const logKey = 'mpa-log:' + location.pathname;
  let sessionLog = [];
  try { sessionLog = JSON.parse(sessionStorage.getItem(logKey) || '[]'); } catch (e) { sessionLog = []; }
  let clickCount = 0;

  // 📝 セッション記録へ1件追加する
  function logEvent(msg) {
    sessionLog.push({ time: formatHMS(new Date()), msg });
    try { sessionStorage.setItem(logKey, JSON.stringify(sessionLog)); } catch (e) { /* noop */ }
  }

  // 📋 現在のセッション記録から報告文を作る
  function buildReport() {
    return buildReportText({
      title: document.title,
      href: location.href,
      mode: settings.mode,
      clickCount,
      reloadCount,
      events: sessionLog,
    });
  }

  // ----------------------------------------
  // 🔢 1日のクリック上限
  // ----------------------------------------

  // 🔢 今日のクリック回数を読む
  function dailyCount() {
    try {
      return readDailyCount(localStorage.getItem('mpa-daily'), new Date().toDateString());
    } catch (e) { return 0; }
  }

  // 🔢 今日のクリック回数を1増やして保存する
  function bumpDaily() {
    try {
      const next = bumpedDaily(localStorage.getItem('mpa-daily'), new Date().toDateString());
      localStorage.setItem('mpa-daily', JSON.stringify(next));
      return next.count;
    } catch (e) { return 0; }
  }

  let dangerStopped = false;

  // 🛑 稼働を止めて停止理由を記録・通知する
  function stopAll(reason) {
    if (!settings.running) return;
    settings.running = false;
    try { localStorage.removeItem('mpa-run-started'); } catch (e) { /* noop */ }
    saveSettings();
    logEvent(`停止: ${reason}`);
    notify(`停止しました: ${reason}`);
    if (settings.shotOnStop) saveScreenshot('stop');
    syncPanel();
  }

  // ✉️ 子フレームからの通知を受ける
  window.addEventListener('message', (ev) => {
    if (!ev.data) return;
    if (ev.data.type === 'mpa-activity') lastActivityAt = Date.now();
    if (ev.data.type === 'mpa-click') {
      clickCount += 1;
      const dc = bumpDaily();
      if (settings.dailyClickCap > 0 && dc >= settings.dailyClickCap) {
        stopAll(`1日のクリック上限（${settings.dailyClickCap}回）に達しました`);
      }
    }
    if (ev.data.type === 'mpa-action') logEvent(ev.data.msg);
    if (ev.data.type === 'mpa-stuck') stopAll(`行き詰まり検知: ${ev.data.msg || ''}`);
    if (ev.data.type === 'mpa-scenario-done') stopAll(`シナリオ「${ev.data.name || ''}」が完了しました`);
  });

  // 📝 DOM変化とリソース読み込みも「変化」として数える
  //    （ただし DOM 変化はゲーム画面の周辺で起きたものだけを見る。広告や
  //      時刻表示の変化で再読み込みが先延ばしされ続けないようにするため）
  new MutationObserver((muts) => {
    const area = gameAreaEl();
    const container = area ? (area.parentElement || area) : null;
    for (const m of muts) {
      if (!container || container.contains(m.target) || m.target === container) {
        lastActivityAt = Date.now();
        break;
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  let lastRes = 0;
  setInterval(() => {
    try {
      const n = performance.getEntriesByType('resource').length;
      if (n !== lastRes) { lastRes = n; lastActivityAt = Date.now(); }
    } catch (e) { /* noop */ }
  }, 3000);

  // ⚠️ 危険ワード検知（5秒ごと）: ダイアログ内は全ワード、ページ本文は
  //    強いワードだけを見る（お知らせバナーの表示などでの誤停止対策）
  setInterval(() => {
    if (!settings.running || !settings.dangerStop || dangerStopped) return;
    const words = dangerWordList();
    const dialogs = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="popup"], [class*="Popup"], [class*="Dialog"]');
    for (const d of dialogs) {
      const r = d.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const text = d.innerText || '';
      for (const w of words) {
        if (text.includes(w)) {
          dangerStopped = true;
          stopAll(`危険ワード「${w}」を検知`);
          return;
        }
      }
    }
    const bodyText = (document.body && document.body.innerText) || '';
    for (const w of DANGER_STRONG) {
      if (words.includes(w) && bodyText.includes(w)) {
        dangerStopped = true;
        stopAll(`危険ワード「${w}」を検知`);
        return;
      }
    }
  }, 5000);

  // ----------------------------------------
  // 👤 タイトル別プロファイルの自動適用
  // ----------------------------------------
  const profileKey = location.origin + location.pathname;
  if (settings.profiles && settings.profiles[profileKey]) {
    PROFILE_FIELDS.forEach((f) => {
      if (settings.profiles[profileKey][f] !== undefined) settings[f] = settings.profiles[profileKey][f];
    });
    saveSettings();
    logEvent('タイトル別プロファイルを適用しました');
  }

  // ----------------------------------------
  // 🔄 再起動・再読み込み後の稼働復帰
  // ----------------------------------------
  if (settings.running) {
    let rs = 0;
    try { rs = parseInt(localStorage.getItem('mpa-run-started') || '0', 10) || 0; } catch (e) { /* noop */ }
    startedAt = rs || Date.now();
    try { localStorage.setItem('mpa-run-started', String(startedAt)); } catch (e) { /* noop */ }
    logEvent('稼働状態を復帰しました');
  }

  // ----------------------------------------
  // 📷 スクリーンショット
  // ----------------------------------------

  // 📷 スクリーンショットをファイルとして保存する
  async function saveScreenshot(tag) {
    const dataUrl = await requestCapture();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `mpa-shot-${tag}-${Date.now()}.png`;
    a.click();
    logEvent(`スクリーンショットを保存（${tag}）`);
  }

  // ----------------------------------------
  // 🎛️ パネル
  // ----------------------------------------
  const panel = document.createElement('div');
  panel.id = 'mpa-panel';
  panel.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;width:250px;'
    + 'max-height:92vh;overflow-y:auto;'
    + 'background:rgba(18,18,28,.94);color:#fff;font-size:12px;font-family:sans-serif;'
    + 'padding:10px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.4);';
  panel.innerHTML = `
<div style="font-weight:bold;margin-bottom:6px;">🤖 プレイ自動化アシスタント</div>
<div id="mpa-status" style="margin-bottom:6px;opacity:.9;">停止中</div>
<label>モード
<select id="mpa-mode" style="width:100%;margin:2px 0 6px;">
<option value="play">プレイ自動化（ボタンを探して進める）</option>
<option value="watch">見張りのみ（再読み込みだけ）</option>
<option value="advance">進行クリック（静止したら押す）</option>
<option value="repeat">繰り返しクリック（周回）</option>
<option value="scenario">シナリオ再生（記録した操作）</option>
</select>
</label>
<label>会話送り
<select id="mpa-adv" style="margin-left:6px;">
<option value="click">クリック</option>
<option value="space">Spaceキー</option>
<option value="enter">Enterキー</option>
</select>
</label><br>
<label>静止判定（秒）<input id="mpa-settle" type="number" min="1" max="60" style="width:56px;margin-left:6px;"></label><br>
<label>クリック間隔（秒）<input id="mpa-interval" type="number" min="1" max="120" style="width:56px;margin:6px 0 0 6px;"></label><br>
<label>長押し（ミリ秒）<input id="mpa-hold" type="number" min="0" max="3000" step="10" style="width:56px;margin:6px 0 0 6px;"></label><br>
<label>無変化で再読み込み（分）<input id="mpa-stall" type="number" min="1" max="30" style="width:56px;margin:6px 0 0 6px;"></label><br>
<label>最大稼働（分）<input id="mpa-maxrun" type="number" min="5" max="480" style="width:56px;margin:6px 0 0 6px;"></label><br>
<label>1日のクリック上限（0=なし）<input id="mpa-cap" type="number" min="0" max="100000" style="width:64px;margin:6px 0 0 6px;"></label><br>
<label>行き詰まりで停止（回数・0=無効）<input id="mpa-stuck" type="number" min="0" max="20" style="width:52px;margin:6px 0 0 6px;"></label><br>
<label><input id="mpa-jitter" type="checkbox"> クリックにゆらぎ</label>
<label style="margin-left:8px;"><input id="mpa-danger" type="checkbox"> 危険ワードで停止</label><br>
<label><input id="mpa-shotstop" type="checkbox"> 停止時にスクショ保存</label>
<div style="margin-top:6px;">稼働時間帯（空=制限なし）<br>
<input id="mpa-from" type="time"> 〜 <input id="mpa-to" type="time"></div>
<div style="margin-top:4px;">自動開始/停止（空=なし）<br>
<input id="mpa-sstart" type="time"> / <input id="mpa-sstop" type="time"></div>
<div style="margin:8px 0;">
<button id="mpa-addpoint" type="button">＋ ポイント登録（次に押す場所）</button>
<button id="mpa-clearpoints" type="button">クリア</button>
<div id="mpa-points" style="opacity:.85;margin-top:4px;"></div>
</div>
<div style="margin:8px 0;">
<input id="mpa-tplname" type="text" placeholder="ボタンの名前（例: 出撃）" style="width:55%;">
<button id="mpa-addtpl" type="button">🖼 画像で登録</button>
<button id="mpa-cleartpl" type="button">全削除</button>
<div id="mpa-tpls" style="opacity:.85;margin-top:4px;"></div>
<div style="opacity:.7;">「画像で登録」→ ゲーム画面上のボタンをドラッグで囲むと、その画像を探して押せるようになります。</div>
<label>マッチングしきい値（小さいほど厳密）<input id="mpa-tplth" type="number" min="5" max="80" style="width:52px;margin-left:6px;"></label>
</div>
<label><input id="mpa-strict" type="checkbox"> ホワイトリスト方式（下の文字のボタンだけ押す）</label>
<textarea id="mpa-whitelist" rows="3" style="width:100%;" placeholder="1行に1つ（例: 受け取る）"></textarea>
<div style="margin-top:6px;">危険ワード（1行に1つ・空なら既定）</div>
<textarea id="mpa-dangerwords" rows="3" style="width:100%;" placeholder="購入確認&#10;メンテナンス中&#10;通信エラー"></textarea>
<div style="margin-top:6px;">追加ドメイン（1行に1つ・例: *.game-example.com）</div>
<textarea id="mpa-extradomains" rows="2" style="width:100%;" placeholder="別ドメインのiframeで動くゲーム用"></textarea>
<label><input id="mpa-patrol" type="checkbox"> 1タブ巡回（同じタブで順に開く）</label>
<label style="margin-left:6px;">1件あたり（分）<input id="mpa-patrolmin" type="number" min="1" max="60" style="width:52px;"></label>
<textarea id="mpa-patrolurls" rows="3" style="width:100%;" placeholder="巡回するプレイページURLを1行に1つ"></textarea>
<div style="margin:8px 0;border-top:1px solid rgba(255,255,255,.25);padding-top:8px;">
<div style="font-weight:bold;">🎬 操作の記録と再生（シナリオ）</div>
<input id="mpa-scenname" type="text" placeholder="シナリオ名（例: デイリー回収）" style="width:55%;">
<button id="mpa-rec" type="button">⏺ 記録開始</button>
<div id="mpa-recstate" style="opacity:.85;margin-top:4px;"></div>
<label>再生するシナリオ <select id="mpa-scen" style="max-width:130px;"></select></label>
<label style="margin-left:6px;"><input id="mpa-scenloop" type="checkbox"> 繰り返す</label>
<button id="mpa-del-scen" type="button">選択中を削除</button>
<div style="opacity:.7;margin-top:4px;">記録開始後、ふだん通り手動で操作してください（クリックとSpace/Enterを記録）。終わったら「記録終了」。再生はモードを「シナリオ再生」にして開始します。</div>
</div>
<div style="margin:8px 0;border-top:1px solid rgba(255,255,255,.25);padding-top:8px;">
<div style="font-weight:bold;">👤 タイトル別プロファイル</div>
<div id="mpa-profstate" style="opacity:.85;"></div>
<button id="mpa-saveprof" type="button">現在の設定をこのタイトル用に保存</button>
<button id="mpa-delprof" type="button">削除</button>
<div style="opacity:.7;margin-top:4px;">モード・ポイント・登録画像などを、このプレイページ専用の設定として保存し、次回開いたときに自動で適用します。</div>
</div>
<button id="mpa-toggle" type="button" style="width:100%;padding:6px;font-weight:bold;margin-top:8px;">開始</button>
<button id="mpa-shot" type="button" style="width:100%;margin-top:6px;">📷 スクリーンショット保存</button>
<div style="margin-top:8px;">
<button id="mpa-copy" type="button" style="width:100%;">📋 Museへ報告をコピー</button>
<button id="mpa-download" type="button" style="width:100%;margin-top:4px;">💾 ログをJSONで保存</button>
<div style="opacity:.7;margin-top:4px;">コピーした報告をClaudeとのチャットに貼ると、作業まとめアプリへ記録されます。</div>
</div>
<div style="opacity:.7;margin-top:6px;">対象はこのタブだけです。Escキーで即停止します。</div>
`;
  document.documentElement.appendChild(panel);

  const $ = (id) => panel.querySelector(id);
  const statusEl = $('#mpa-status');
  const toggleBtn = $('#mpa-toggle');

  // 🎛️ パネルの表示を設定値に合わせる
  function syncPanel() {
    $('#mpa-mode').value = settings.mode;
    $('#mpa-adv').value = settings.advanceMethod;
    $('#mpa-settle').value = settings.settleSec;
    $('#mpa-interval').value = settings.intervalSec;
    $('#mpa-hold').value = settings.holdMs;
    $('#mpa-stall').value = settings.stallMin;
    $('#mpa-maxrun').value = settings.maxRunMin;
    $('#mpa-cap').value = settings.dailyClickCap;
    $('#mpa-stuck').value = settings.stuckLimit;
    $('#mpa-tplth').value = settings.tplThreshold;
    $('#mpa-dangerwords').value = settings.dangerWordsText || '';
    $('#mpa-extradomains').value = settings.extraDomains || '';
    const scenSel = $('#mpa-scen');
    scenSel.innerHTML = '';
    (settings.scenarios || []).forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = `${s.name}（${s.steps.length}手）`;
      scenSel.appendChild(opt);
    });
    if (settings.activeScenario) scenSel.value = settings.activeScenario;
    $('#mpa-scenloop').checked = !!settings.scenarioLoop;
    $('#mpa-profstate').textContent = settings.profiles && settings.profiles[profileKey]
      ? 'このタイトルのプロファイル: あり（自動適用されます）'
      : 'このタイトルのプロファイル: なし';
    $('#mpa-jitter').checked = !!settings.jitter;
    $('#mpa-danger').checked = !!settings.dangerStop;
    $('#mpa-shotstop').checked = !!settings.shotOnStop;
    $('#mpa-from').value = settings.allowFrom || '';
    $('#mpa-to').value = settings.allowTo || '';
    $('#mpa-sstart').value = settings.scheduleStart || '';
    $('#mpa-sstop').value = settings.scheduleStop || '';
    $('#mpa-strict').checked = !!settings.strictWhitelist;
    $('#mpa-whitelist').value = settings.whitelist || '';
    $('#mpa-patrol').checked = !!settings.patrol;
    $('#mpa-patrolmin').value = settings.patrolMin;
    $('#mpa-patrolurls').value = settings.patrolUrls || '';
    $('#mpa-points').textContent = 'ポイント: '
      + settings.points.map((p, i) => `${i + 1}(${p.x}%, ${p.y}%)`).join(' ');
    $('#mpa-tpls').textContent = '登録画像: '
      + (settings.templates || []).map((t) => t.name).join('、') + `（${(settings.templates || []).length}件）`;
    toggleBtn.textContent = settings.running ? '停止' : '開始';
  }

  // 🎛️ パネルの入力値を設定へ読み取る（範囲外の値は丸める）
  function readPanel() {
    settings.mode = $('#mpa-mode').value;
    settings.advanceMethod = $('#mpa-adv').value;
    settings.settleSec = Math.max(1, parseInt($('#mpa-settle').value, 10) || DEFAULT_SETTINGS.settleSec);
    settings.intervalSec = Math.max(1, parseInt($('#mpa-interval').value, 10) || DEFAULT_SETTINGS.intervalSec);
    settings.holdMs = Math.max(0, parseInt($('#mpa-hold').value, 10) || 0);
    settings.stallMin = Math.max(1, parseInt($('#mpa-stall').value, 10) || DEFAULT_SETTINGS.stallMin);
    settings.maxRunMin = Math.max(5, parseInt($('#mpa-maxrun').value, 10) || DEFAULT_SETTINGS.maxRunMin);
    settings.dailyClickCap = Math.max(0, parseInt($('#mpa-cap').value, 10) || 0);
    settings.stuckLimit = Math.max(0, parseInt($('#mpa-stuck').value, 10) || 0);
    settings.activeScenario = $('#mpa-scen').value || '';
    settings.scenarioLoop = $('#mpa-scenloop').checked;
    settings.jitter = $('#mpa-jitter').checked;
    settings.dangerStop = $('#mpa-danger').checked;
    settings.shotOnStop = $('#mpa-shotstop').checked;
    settings.allowFrom = $('#mpa-from').value || '';
    settings.allowTo = $('#mpa-to').value || '';
    settings.scheduleStart = $('#mpa-sstart').value || '';
    settings.scheduleStop = $('#mpa-sstop').value || '';
    settings.strictWhitelist = $('#mpa-strict').checked;
    settings.whitelist = $('#mpa-whitelist').value;
    settings.patrol = $('#mpa-patrol').checked;
    settings.patrolMin = Math.max(1, parseInt($('#mpa-patrolmin').value, 10) || DEFAULT_SETTINGS.patrolMin);
    settings.patrolUrls = $('#mpa-patrolurls').value;
    settings.tplThreshold = Math.min(80, Math.max(5, parseInt($('#mpa-tplth').value, 10) || DEFAULT_SETTINGS.tplThreshold));
    settings.dangerWordsText = $('#mpa-dangerwords').value;
    settings.extraDomains = $('#mpa-extradomains').value;
    // 🌐 追加ドメインはサービスワーカーへ登録し直してもらう
    try {
      chrome.runtime.sendMessage({ type: 'mpa-register-extra', hosts: parseLines(settings.extraDomains) });
    } catch (e) { /* noop */ }
    saveSettings();
  }

  // ▶️ 開始／停止ボタン
  toggleBtn.addEventListener('click', () => {
    readPanel();
    settings.running = !settings.running;
    startedAt = settings.running ? Date.now() : 0;
    try {
      if (settings.running) localStorage.setItem('mpa-run-started', String(startedAt));
      else localStorage.removeItem('mpa-run-started');
    } catch (e) { /* noop */ }
    if (settings.running) {
      dangerStopped = false;
      lastActivityAt = Date.now();
      try { localStorage.setItem('mpa-patrol:' + location.href, String(Date.now())); } catch (e) { /* noop */ }
      logEvent(`開始（モード: ${settings.mode}）`);
    } else {
      logEvent(`停止（クリック ${clickCount}回 / 再読み込み ${reloadCount}回）`);
    }
    saveSettings();
    syncPanel();
  });

  // ----------------------------------------
  // 🎬 シナリオ記録の開始・終了
  // ----------------------------------------
  let recording = false;
  try {
    chrome.storage.local.get('mpaRecording', (res) => {
      if (res && res.mpaRecording) {
        recording = true;
        $('#mpa-rec').textContent = '⏹ 記録終了';
        $('#mpa-recstate').textContent = `記録中: 「${res.mpaRecording.name}」 手動で操作してください`;
      }
    });
  } catch (e) { /* noop */ }
  $('#mpa-rec').addEventListener('click', () => {
    readPanel();
    if (!recording) {
      const name = ($('#mpa-scenname').value || '').trim() || `シナリオ${(settings.scenarios || []).length + 1}`;
      try {
        chrome.storage.local.set({
          mpaRecording: { name, startedAt: Date.now() },
          mpaRecordBuffer: [],
        }, () => {
          recording = true;
          $('#mpa-rec').textContent = '⏹ 記録終了';
          $('#mpa-recstate').textContent = `記録中: 「${name}」 手動で操作してください`;
        });
      } catch (e) { /* noop */ }
    } else {
      try {
        chrome.storage.local.get(['mpaRecording', 'mpaRecordBuffer'], (res) => {
          const rec = res.mpaRecording || { name: 'シナリオ', startedAt: Date.now() };
          const steps = buildScenarioSteps(rec, res.mpaRecordBuffer || []);
          settings.scenarios = [...(settings.scenarios || []).filter((s) => s.name !== rec.name),
            { name: rec.name, url: location.href, steps }];
          settings.activeScenario = rec.name;
          saveSettings();
          chrome.storage.local.remove(['mpaRecording', 'mpaRecordBuffer']);
          recording = false;
          $('#mpa-rec').textContent = '⏺ 記録開始';
          $('#mpa-recstate').textContent = `「${rec.name}」を保存しました（${steps.length}手）`;
          logEvent(`シナリオを記録: 「${rec.name}」（${steps.length}手）`);
          syncPanel();
        });
      } catch (e) { /* noop */ }
    }
  });
  $('#mpa-del-scen').addEventListener('click', () => {
    readPanel();
    const name = settings.activeScenario;
    if (!name) return;
    settings.scenarios = (settings.scenarios || []).filter((s) => s.name !== name);
    settings.activeScenario = (settings.scenarios[0] || {}).name || '';
    saveSettings();
    syncPanel();
  });

  // ----------------------------------------
  // 👤 プロファイル保存・削除
  // ----------------------------------------
  $('#mpa-saveprof').addEventListener('click', () => {
    readPanel();
    const prof = {};
    PROFILE_FIELDS.forEach((f) => { prof[f] = settings[f]; });
    settings.profiles = { ...(settings.profiles || {}), [profileKey]: prof };
    saveSettings();
    logEvent('タイトル別プロファイルを保存しました');
    syncPanel();
  });
  $('#mpa-delprof').addEventListener('click', () => {
    if (settings.profiles) delete settings.profiles[profileKey];
    saveSettings();
    syncPanel();
  });

  // ----------------------------------------
  // 📍 ポイント・テンプレートの管理
  // ----------------------------------------
  $('#mpa-addpoint').addEventListener('click', () => {
    registeringPoint = true;
    statusEl.textContent = '次のクリック位置をポイントとして登録します…';
  });
  $('#mpa-clearpoints').addEventListener('click', () => {
    settings.points = [];
    saveSettings();
    syncPanel();
  });
  $('#mpa-cleartpl').addEventListener('click', () => {
    readPanel();
    settings.templates = [];
    saveSettings();
    refreshTemplateImages();
    syncPanel();
  });
  $('#mpa-shot').addEventListener('click', () => saveScreenshot('manual'));
  $('#mpa-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildReport());
      statusEl.textContent = '報告をコピーしました。チャットに貼ってください（スクショも保存しました）';
      saveScreenshot('report');
    } catch (e) {
      statusEl.textContent = 'コピーに失敗しました。JSON保存を使ってください。';
    }
  });
  $('#mpa-download').addEventListener('click', () => {
    const data = {
      tool: 'dmm-play-assistant',
      version: '1.0.0',
      page: location.href,
      title: document.title,
      mode: settings.mode,
      clickCount,
      reloadCount,
      events: sessionLog,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mpa-log.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // 💾 ポイント登録: 次の1クリックをゲーム画面に対する % で記録
  document.addEventListener('click', (ev) => {
    if (!registeringPoint) return;
    if (panel.contains(ev.target)) return;
    registeringPoint = false;
    const area = gameAreaEl();
    let px = 50;
    let py = 78;
    if (area) {
      const r = area.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        px = pctOfPoint(ev.clientX, r.left, r.width);
        py = pctOfPoint(ev.clientY, r.top, r.height);
      }
    }
    settings.points.push({ x: px, y: py });
    saveSettings();
    syncPanel();
  }, true);

  // ----------------------------------------
  // 🖼️ テンプレート登録（ドラッグで囲む）
  // ----------------------------------------
  $('#mpa-addtpl').addEventListener('click', async () => {
    readPanel();
    const name = ($('#mpa-tplname').value || '').trim()
      || `ボタン${(settings.templates || []).length + 1}`;
    statusEl.textContent = 'ゲーム画面上のボタンをドラッグで囲んでください…';
    const rect = await dragSelect();
    if (!rect) { statusEl.textContent = '登録をキャンセルしました'; return; }
    const area = gameAreaEl();
    if (!area) { statusEl.textContent = 'ゲーム画面が見つかりません'; return; }
    // 📐 選択範囲とゲーム画面の重なり部分だけを切り取る
    const ar = area.getBoundingClientRect();
    const ix = Math.max(rect.x, ar.left);
    const iy = Math.max(rect.y, ar.top);
    const ir = Math.min(rect.x + rect.w, ar.right);
    const ib = Math.min(rect.y + rect.h, ar.bottom);
    if (ir - ix < 8 || ib - iy < 8) { statusEl.textContent = '選択範囲がゲーム画面と重なりません'; return; }
    const shot = await requestCapture();
    if (!shot) { statusEl.textContent = '画面の取得に失敗しました'; return; }
    const img = new Image();
    img.onload = () => {
      const dpr = img.naturalWidth / window.innerWidth;
      const crop = document.createElement('canvas');
      // 📝 切り取り画像は幅160pxを上限に縮小する（ストレージ節約）
      const scaleBack = Math.min(1, 160 / ((ir - ix) * dpr));
      crop.width = Math.max(8, Math.round((ir - ix) * dpr * scaleBack));
      crop.height = Math.max(8, Math.round((ib - iy) * dpr * scaleBack));
      crop.getContext('2d').drawImage(
        img,
        ix * dpr, iy * dpr, (ir - ix) * dpr, (ib - iy) * dpr,
        0, 0, crop.width, crop.height,
      );
      const wPct = Math.round(((ir - ix) / ar.width) * 1000) / 10;
      settings.templates = [...(settings.templates || []), { name, dataUrl: crop.toDataURL('image/png'), wPct }];
      saveSettings();
      refreshTemplateImages();
      logEvent(`画像テンプレートを登録: 「${name}」`);
      syncPanel();
      statusEl.textContent = `「${name}」を登録しました`;
    };
    img.src = shot;
  });

  // 🖼️ ドラッグで囲んだ矩形を返す（テンプレート登録用。60秒で自動キャンセル）
  function dragSelect() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:rgba(0,0,0,.15);';
      const boxEl = document.createElement('div');
      boxEl.style.cssText = 'position:fixed;border:2px solid #4da3ff;background:rgba(77,163,255,.2);display:none;';
      overlay.appendChild(boxEl);
      document.documentElement.appendChild(overlay);
      let sx = 0;
      let sy = 0;
      let dragging = false;
      overlay.addEventListener('mousedown', (e) => {
        dragging = true;
        sx = e.clientX;
        sy = e.clientY;
        boxEl.style.display = 'block';
        boxEl.style.left = `${sx}px`;
        boxEl.style.top = `${sy}px`;
        boxEl.style.width = '0px';
        boxEl.style.height = '0px';
      });
      overlay.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        boxEl.style.left = `${Math.min(sx, e.clientX)}px`;
        boxEl.style.top = `${Math.min(sy, e.clientY)}px`;
        boxEl.style.width = `${Math.abs(e.clientX - sx)}px`;
        boxEl.style.height = `${Math.abs(e.clientY - sy)}px`;
      });
      overlay.addEventListener('mouseup', (e) => {
        const rect = {
          x: Math.min(sx, e.clientX),
          y: Math.min(sy, e.clientY),
          w: Math.abs(e.clientX - sx),
          h: Math.abs(e.clientY - sy),
        };
        overlay.remove();
        resolve(rect.w >= 8 && rect.h >= 8 ? rect : null);
      });
      setTimeout(() => { if (document.contains(overlay)) { overlay.remove(); resolve(null); } }, 60000);
    });
  }

  // ----------------------------------------
  // 🔁 巡回
  // ----------------------------------------

  // 🔁 滞在時間が過ぎたら巡回リストの次へ移動する
  function patrolTick() {
    if (!settings.running || !settings.patrol) return;
    const urls = parseLines(settings.patrolUrls);
    if (urls.length < 2) return;
    let pageStarted = 0;
    try { pageStarted = parseInt(localStorage.getItem('mpa-patrol:' + location.href) || '0', 10) || 0; } catch (e) { /* noop */ }
    if (!pageStarted) {
      try { localStorage.setItem('mpa-patrol:' + location.href, String(Date.now())); } catch (e) { /* noop */ }
      return;
    }
    if (Date.now() - pageStarted < settings.patrolMin * 60 * 1000) return;
    const next = patrolNextUrl(urls, location.href);
    logEvent(`巡回: 次のタイトルへ移動 (${next})`);
    try { localStorage.setItem('mpa-patrol:' + location.href, String(Date.now())); } catch (e) { /* noop */ }
    location.href = next;
  }

  // ----------------------------------------
  // 📅 スケジュール
  // ----------------------------------------

  // 📅 開始・停止のスケジュール時刻を判定する（毎分ちょうどに一致したら発火）
  function scheduleTick() {
    const t = nowHHMM();
    if (settings.scheduleStart && t === settings.scheduleStart && !settings.running) {
      settings.running = true;
      startedAt = Date.now();
      dangerStopped = false;
      lastActivityAt = Date.now();
      try { localStorage.setItem('mpa-patrol:' + location.href, String(Date.now())); } catch (e) { /* noop */ }
      saveSettings();
      logEvent('スケジュールで自動開始');
      notify('スケジュールで自動開始しました');
      syncPanel();
    }
    if (settings.scheduleStop && t === settings.scheduleStop && settings.running) {
      stopAll('スケジュールで自動停止');
    }
  }

  // ----------------------------------------
  // 👀 見張りループ（1秒ごと）
  // ----------------------------------------
  setInterval(() => {
    scheduleTick();
    patrolTick();
    if (!settings.running) {
      statusEl.textContent = '停止中';
      return;
    }
    // 🛑 最大稼働時間に達したら停止
    if (startedAt && Date.now() - startedAt >= settings.maxRunMin * 60 * 1000) {
      stopAll('最大稼働時間に達しました');
      return;
    }
    // 🔄 一定時間まったく変化が無ければ1回だけ再読み込み（上限あり）
    const idleMs = Date.now() - lastActivityAt;
    const remainMin = Math.max(0, Math.ceil((settings.stallMin * 60 * 1000 - idleMs) / 60000));
    if (idleMs >= settings.stallMin * 60 * 1000) {
      if (reloadCount < MAX_RELOADS) {
        reloadCount += 1;
        try { sessionStorage.setItem(reloadKey, String(reloadCount)); } catch (e) { /* noop */ }
        logEvent(`無変化が続いたため自動再読み込み（${reloadCount}回目）`);
        statusEl.textContent = '変化が無いため再読み込みします…';
        location.reload();
        return;
      }
      statusEl.textContent = `再読み込み上限(${MAX_RELOADS}回)に達したため見張りを停止中`;
      return;
    }
    const windowNote = inAllowWindow() ? '' : '（時間帯外のため待機中）';
    statusEl.textContent = `稼働中（${settings.mode}）${windowNote}／ クリック ${clickCount}回 ／ 無変化が続けばあと約${remainMin}分で再読み込み ／ 再読み込み ${reloadCount}/${MAX_RELOADS}回`;
  }, TICK_MS);

  syncPanel();
}
