'use strict';
// ========================================
// 🎨 アイコン (icon.png) の生成
// ========================================
// 128x128 の PNG を依存ライブラリなしで生成する。
// デザイン: 濃紺の角丸スクエアに、白い再生三角形とオレンジのドット。
// 使い方: node tools/gen-icon.js  （icon.png が上書きされる）
// ========================================

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 128;

// 🎨 1ピクセルの色を決める
function pixelAt(x, y) {
  // 角丸スクエアの内側かどうか（半径28px）
  const r = 28;
  const cx = Math.min(Math.max(x, r), SIZE - 1 - r);
  const cy = Math.min(Math.max(y, r), SIZE - 1 - r);
  const dx = x - cx;
  const dy = y - cy;
  if (dx * dx + dy * dy > r * r && (x < r || x > SIZE - 1 - r || y < r || y > SIZE - 1 - r)) {
    return [0, 0, 0, 0]; // 角は透明
  }
  // 再生三角形（白）: 左寄りの三角形
  const triLeft = 44;
  const triRight = 92;
  const triTop = 40;
  const triBottom = 88;
  if (x >= triLeft && x <= triRight && y >= triTop && y <= triBottom) {
    const t = (x - triLeft) / (triRight - triLeft);
    const half = ((triBottom - triTop) / 2) * (1 - t);
    const mid = (triTop + triBottom) / 2;
    if (Math.abs(y - mid) <= half) return [255, 255, 255, 255];
  }
  // オレンジのドット（右下）
  const ddx = x - 98;
  const ddy = y - 98;
  if (ddx * ddx + ddy * ddy <= 9 * 9) return [255, 149, 0, 255];
  // 背景: 濃紺
  return [24, 24, 38, 255];
}

// 🧱 PNG のチャンクを作る
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    crc32.table = table;
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng() {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  let o = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[o] = 0; // フィルタ: None
    o += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
      o += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // ビット深度
  ihdr[9] = 6;  // カラータイプ: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'icon.png');
fs.writeFileSync(out, encodePng());
console.log(`gen-icon: ${out} を生成しました`);
