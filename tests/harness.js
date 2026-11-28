'use strict';
// ========================================
// 🧪 テスト用ハーネス
// ========================================
// 拡張機能の実ファイルを Node の vm 上で読み込み、ブラウザ環境を
// 最小限のスタブで再現して、公開された関数をテストから触れるようにする。
// content_scripts は manifest の並び順どおり同一スコープで連結して実行する
// （拡張機能の実際の実行方式と同じ）。
// 起動処理（loadSettings のコールバック）は発火させない: chrome.storage の
// get はコールバックを呼ばないスタブにしてある。
// ========================================

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const CONTENT_FILES = [
  'content/01-settings-utils.js',
  'content/02-dom-hunter.js',
  'content/03-storage-player.js',
  'content/04-top-frame.js',
  'content/05-recorder-main.js',
];

// 🧱 汎用要素スタブ
function makeElement(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    style: {},
    children: [],
    textContent: '',
    innerText: '',
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    querySelector() { return null; },
    closest() { return null; },
    contains() { return false; },
    remove() {},
    click() {},
  };
}

// 🖼️ canvas スタブ（getImageData は state.sampleData を返す）
function makeCanvas(state) {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext() {
      return {
        drawImage() {},
        getImageData() { return { data: state.sampleData }; },
      };
    },
    toDataURL() { return 'data:image/png;base64,'; },
    getBoundingClientRect() { return { width: this.width, height: this.height, left: 0, top: 0, right: this.width, bottom: this.height }; },
  };
}

// 🎮 content_scripts 一式を読み込んだ環境を作る
function loadContent() {
  const state = {
    canvases: [],                                        // querySelectorAll('canvas') の戻り
    sampleData: new Uint8ClampedArray(32 * 18 * 4).fill(128), // canvasState のサンプル元
    posted: [],                                          // window.top.postMessage の記録
  };
  const documentStub = {
    createElement: (tag) => (tag === 'canvas' ? makeCanvas(state) : makeElement(tag)),
    querySelectorAll: (sel) => (sel === 'canvas' ? state.canvases : []),
    querySelector: () => null,
    addEventListener: () => {},
    documentElement: makeElement('html'),
    body: { innerText: '' },
    title: 'テストページ',
  };
  state.body = documentStub.body;

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: documentStub,
    location: { pathname: '/game', origin: 'https://play.games.dmm.com', href: 'https://play.games.dmm.com/game' },
    innerWidth: 1280,
    innerHeight: 720,
    chrome: {
      storage: {
        local: { get: () => {}, set: () => {}, remove: () => {} },
        onChanged: { addListener: () => {} },
      },
      runtime: { sendMessage: () => {} },
    },
    Image: class { constructor() { this.naturalWidth = 0; this.naturalHeight = 0; } },
    MutationObserver: class { observe() {} },
    performance: { getEntriesByType: () => [] },
    navigator: {},
    PointerEvent: class { constructor(type, opts) { this.type = type; Object.assign(this, opts); } },
    MouseEvent: class { constructor(type, opts) { this.type = type; Object.assign(this, opts); } },
    KeyboardEvent: class { constructor(type, opts) { this.type = type; Object.assign(this, opts); } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  sandbox.postMessage = (data) => { state.posted.push(data); };

  const context = vm.createContext(sandbox);
  const source = CONTENT_FILES
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n;\n');
  const epilogue = `
;globalThis.__api = {
  DEFAULT_SETTINGS, DANGER_WORDS, DANGER_STRONG, PROFILE_FIELDS, MAX_RELOADS, TICK_MS,
  parseLines, clampPct, pctOfPoint, jitterPct, jitterMs, hhmmOf, nowHHMM,
  inWindow, inAllowWindow,
  getSettings: () => settings,
  setSettings: (patch) => { settings = { ...settings, ...patch }; },
  largestCanvas, gameAreaEl, isPlayerFrame, canvasState,
  normalizeButtonText, isDeniedText, isBlockedGacha, matchPlayRule, whitelistSet,
  domSignature, grayArray, meanAbsScore,
  clampScenarioDelay, findActiveScenario,
  formatHMS, dangerWordList, readDailyCount, bumpedDaily,
  buildScenarioSteps, patrolNextUrl, buildReportText, pointFromEvent,
};`;
  vm.runInContext(source + epilogue, context, { filename: 'content-bundle.js' });
  return { api: context.__api, state, sandbox };
}

// ⚙️ background.js（サービスワーカー）を読み込んだ環境を作る
function loadBackground(savedSettings) {
  const calls = {
    registered: [],
    unregistered: [],
    listeners: {},
    notifications: [],
    captures: 0,
  };
  const chromeStub = {
    scripting: {
      unregisterContentScripts: async ({ ids }) => { calls.unregistered.push(ids); },
      registerContentScripts: async (defs) => { calls.registered.push(defs); },
    },
    storage: {
      local: {
        get: (key, cb) => { cb({ mpaSettings: savedSettings || {} }); },
      },
    },
    runtime: {
      onStartup: { addListener: (fn) => { calls.listeners.startup = fn; } },
      onInstalled: { addListener: (fn) => { calls.listeners.installed = fn; } },
      onMessage: { addListener: (fn) => { calls.listeners.message = fn; } },
      lastError: null,
    },
    tabs: {
      captureVisibleTab: (windowId, opts, cb) => { calls.captures += 1; cb('data:image/png;base64,xyz'); },
    },
    notifications: {
      create: (opts) => { calls.notifications.push(opts); },
    },
  };
  const sandbox = { console, chrome: chromeStub };
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const epilogue = `
;globalThis.__api = { toMatchPattern, registerExtraDomains, CONTENT_SCRIPT_FILES };`;
  vm.runInContext(source + epilogue, context, { filename: 'background.js' });
  return { api: context.__api, calls };
}

// 🧀 vm 内で作られた値を通常のオブジェクトへ変換する
//    （deepStrictEqual がプロトタイプの違いで失敗しないようにするため）
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { loadContent, loadBackground, ROOT, CONTENT_FILES, plain };
