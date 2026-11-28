'use strict';
// ========================================
// 🎮 本体2: プレイ自動化（汎用）
// ========================================
// DOMボタン探索と、テンプレート画像マッチングを担当する。
// お金が絡むボタンは絶対に押さない（ガチャ系は「無料」「チケット」のみ許可）。
// ========================================

// ----------------------------------------
// 🔍 DOMボタン探索
// ----------------------------------------

// 🚫 お金が絡むボタンの文字（絶対に押さない）
const DENY_TEXT = /購入|チャージ|課金|有償|支払|買う|円で|ポイントを使う|ダイヤを使う|ジェムを使う/;

// 🎯 押す対象の優先順ルール（上から順に探す）
const PLAY_RULES = [
  { re: /^(閉じる|OK|決定|確認|はい|×|✕)$/, label: 'ダイアログを閉じる' },
  { re: /受け取|受取|一括/, label: '報酬を受け取る' },
  { re: /オート|AUTO|自動/, label: 'オートを押す' },
  { re: /スキップ|SKIP/, label: 'スキップする' },
  { re: /次へ|進む|タップ|続ける|スタート|はじめる|挑戦|出撃/, label: '次へ進む' },
];

let lastHunterActionAt = 0; // 探索で最後にボタンを押した時刻

// 📝 ボタンの表示文字を正規化する（前後の空白除去＋空白の圧縮）
function normalizeButtonText(raw) {
  return (raw || '').trim().replace(/\s+/g, ' ');
}

// 🚫 お金が絡む文字かどうか
function isDeniedText(text) {
  return DENY_TEXT.test(text);
}

// 🚫 ガチャ系で、無料／チケット以外は押してはいけないかどうか
function isBlockedGacha(text) {
  return /ガチャ|引く/.test(text) && !/無料|チケット/.test(text);
}

// 🎯 文字に一致する優先順ルールを返す（無ければ null）
function matchPlayRule(text) {
  for (const rule of PLAY_RULES) {
    if (rule.re.test(text)) return rule;
  }
  return null;
}

// 📋 ホワイトリスト（1行に1つ）を集合にする
function whitelistSet() {
  return new Set(parseLines(settings.whitelist));
}

// 🎯 優先順に押すべきボタン（DOM）を探す
//    戻り値: { el, text, label } か null
function findPlayTarget() {
  const els = document.querySelectorAll('button, a, [role="button"], [onclick], [class*="btn"], [class*="button"]');
  const white = settings.strictWhitelist ? whitelistSet() : null;
  // 📝 ホワイトリスト方式では優先順ルールを使わず、登録文字と完全一致だけを見る
  const rulesToTry = white ? [null] : PLAY_RULES;
  for (const rule of rulesToTry) {
    for (const el of els) {
      // 🛡️ 自分自身のパネルとバッジは対象外
      if (el.closest('#mpa-panel') || el.closest('#mpa-badge')) continue;
      const text = normalizeButtonText(el.innerText || el.textContent || '');
      if (!text || text.length > 40) continue;
      if (isDeniedText(text)) continue;
      if (isBlockedGacha(text)) continue;
      let label;
      if (white) {
        if (!white.has(text)) continue;
        label = 'ホワイトリストのボタンを押す';
      } else {
        if (!rule.re.test(text)) continue;
        label = rule.label;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // 🖥️ button/a 以外は「押せそうな要素」だけに絞る（divボタン等の取りこぼし対策）
      const tag = el.tagName;
      if (tag !== 'BUTTON' && tag !== 'A'
        && !el.hasAttribute('onclick')
        && el.getAttribute('role') !== 'button'
        && style.cursor !== 'pointer') continue;
      return { el, text, label };
    }
  }
  return null;
}

// 🔍 ページ本文の長さとハッシュで画面の署名を作る（行き詰まり検知用）
function domSignature() {
  try {
    const t = (document.body && document.body.innerText) || '';
    let h = 0;
    for (let i = 0; i < t.length; i += 7) h = ((h * 31) + t.charCodeAt(i)) | 0;
    return `${t.length}:${h}`;
  } catch (e) { return ''; }
}

// 📝 探索の行き詰まり状態（同じボタンを押しても画面が変わらない回数）
const hunterSameText = { text: '', sig: '', count: 0 };

// 🎯 1.5秒ごとにボタン探索とクリックを繰り返す
function runDomHunter() {
  setInterval(() => {
    if (!settings.running || settings.mode !== 'play' || !inAllowWindow()) return;
    const hit = findPlayTarget();
    if (!hit) return;
    const now = Date.now();
    // 📝 同一ボタンのクールダウンは設けない。行き詰まり検知の抑制だけ残す
    // 行き詰まり検知: 同じボタンを押しても画面（文字）が変わらない状態が続いたら知らせる
    const sig = domSignature();
    if (hunterSameText.text === hit.text && hunterSameText.sig === sig) {
      hunterSameText.count += 1;
    } else {
      hunterSameText.text = hit.text;
      hunterSameText.sig = sig;
      hunterSameText.count = 1;
    }
    if (settings.stuckLimit > 0 && hunterSameText.count >= 4) {
      hunterSameText.count = 0;
      postToTop({ type: 'mpa-stuck', msg: `「${hit.text}」を押しても画面が変わりません` });
      return;
    }
    lastHunterActionAt = now;
    lastClickAt = now;
    try { hit.el.click(); } catch (e) { return; }
    postToTop({ type: 'mpa-click' });
    postToTop({ type: 'mpa-action', msg: `${hit.label}: 「${hit.text}」` });
  }, 1500);
}

// ----------------------------------------
// 🖼️ テンプレート画像マッチング（canvas 内のボタンを探す）
// ----------------------------------------

const tplImages = new Map(); // name -> {img, wPct}

// 🖼️ 登録済みテンプレート画像を読み込み直す（設定の templates と同期する）
function refreshTemplateImages() {
  const want = new Map((settings.templates || []).map((t) => [t.name, t]));
  for (const name of [...tplImages.keys()]) {
    if (!want.has(name)) tplImages.delete(name);
  }
  want.forEach((t, name) => {
    if (!tplImages.has(name)) {
      const img = new Image();
      img.onload = () => tplImages.set(name, { img, wPct: t.wPct || 20 });
      img.src = t.dataUrl;
    }
  });
}

// 🖼️ 画像をグレースケール＋色味の配列へ変換する
//    g: 明るさ (3R+6G+B)/10、c: 色味（赤−青）
function grayArray(canvasEl) {
  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height).data;
  const g = new Uint8Array(canvasEl.width * canvasEl.height);
  const c = new Int16Array(canvasEl.width * canvasEl.height);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 1) {
    g[j] = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
    c[j] = d[i] - d[i + 2];
  }
  return { g, c };
}

// 🖼️ フレーム内の (x, y) 位置にテンプレートを重ねたときの平均誤差を返す
//    明るさ7割 + 色味3割でスコア化し、2ピクセルおきにサンプリングする
function meanAbsScore(frame, tpl, frameWidth, tplWidth, tplHeight, x, y) {
  let sum = 0;
  let cnt = 0;
  for (let ty = 0; ty < tplHeight; ty += 2) {
    const fRow = (y + ty) * frameWidth + x;
    const tRow = ty * tplWidth;
    for (let tx = 0; tx < tplWidth; tx += 2) {
      const idx = fRow + tx;
      const tidx = tRow + tx;
      sum += Math.abs(frame.g[idx] - tpl.g[tidx]) * 0.7
        + Math.abs(frame.c[idx] - tpl.c[tidx]) * 0.3;
      cnt += 1;
    }
  }
  return sum / Math.max(1, cnt);
}

// 🖼️ 登録画像を canvas から探して見つかれば押す（押したら true）
function matchTemplates() {
  const c = largestCanvas();
  if (!c || tplImages.size === 0) return false;
  // 📝 探索は幅320pxに縮小したフレームに対して行う（負荷対策）
  const W = 320;
  const scale = W / (c.width || W);
  const H = Math.max(1, Math.round((c.height || W) * scale));
  const work = document.createElement('canvas');
  work.width = W;
  work.height = H;
  try {
    work.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0, W, H);
  } catch (e) { return false; }
  const frame = grayArray(work);
  const threshold = settings.tplThreshold || 26;
  for (const [name, t] of tplImages) {
    // 📝 マルチスケール: 登録時の大きさと前後（0.8倍/1.25倍）でも探す（解像度変化への耐性）
    for (const scaleMul of [1, 0.8, 1.25]) {
      const tw = Math.max(12, Math.round(((W * t.wPct) / 100) * scaleMul));
      const th = Math.max(8, Math.round(tw * (t.img.naturalHeight / Math.max(1, t.img.naturalWidth))));
      if (tw >= W || th >= H) continue;
      const tc = document.createElement('canvas');
      tc.width = tw;
      tc.height = th;
      tc.getContext('2d', { willReadFrequently: true }).drawImage(t.img, 0, 0, tw, th);
      const tpl = grayArray(tc);
      let best = Infinity;
      let bestX = 0;
      let bestY = 0;
      const step = 3;
      for (let y = 0; y + th <= H; y += step) {
        for (let x = 0; x + tw <= W; x += step) {
          const mean = meanAbsScore(frame, tpl, W, tw, th, x, y);
          if (mean < best) { best = mean; bestX = x; bestY = y; }
        }
      }
      if (best < threshold) {
        const now = Date.now();
        // 📝 テンプレートのクールダウンは設けない
        lastHunterActionAt = now;
        clickAtPercent({
          x: ((bestX + tw / 2) / W) * 100,
          y: ((bestY + th / 2) / H) * 100,
        });
        postToTop({ type: 'mpa-action', msg: `画像マッチングでボタンを押した: 「${name}」` });
        return true;
      }
    }
  }
  return false;
}
