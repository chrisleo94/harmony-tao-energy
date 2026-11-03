import http from 'node:http';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Device, root, runtime, hdcPath, discardFrame } from './device.mjs';
import { Preview } from './preview.mjs';
import { Flow, inspect, center } from './recognition.mjs';

const port = Number(process.env.PORT || 17883);
const state = { version: '0.3.0', running: false, busy: false, done: 0, page: '', message: '请连接手机后检测设备', logs: [], snapshot: null };
let aborter;
const preview = new Preview();
function log(message) {
  state.message = message;
  const item = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), message };
  state.logs.push(item); if (state.logs.length > 200) state.logs.shift();
  console.log(`[${item.time}] ${message}`);
  appendFile(path.join(runtime, 'run.log'), `${new Date().toISOString()} ${message}\n`).catch(() => {});
}
async function observe(device) {
  const frame = await device.capture();
  try {
  let nodes = frame.nodes, view = inspect(nodes, frame.width, frame.height), source = '控件树';
  // WebView often does not expose H5 task text. Windows OCR stays entirely local.
  if (['unknown', 'tasks', 'complete', 'search'].includes(view.page)) {
    try {
      const ocrNodes = await device.ocr(frame.png);
      const merged = [...nodes, ...ocrNodes];
      const ocrView = inspect(merged, frame.width, frame.height);
      nodes = merged; view = ocrView; source = '控件树 + 本地OCR';
    } catch (e) {
      device.signal?.throwIfAborted();
      if (view.page === 'unknown' || (view.page === 'tasks' && !view.tasks.length)) throw new Error(`文字识别失败：${e.message}`);
      // Completion header from layout is still valid; absence of OCR means use Back.
    }
  }
  state.page = view.page;
  device.signal?.throwIfAborted();
  await preview.publish(frame);
  state.snapshot = { width: frame.width, height: frame.height, source, text: nodes.map(n => n.text).join('\n'), at: Date.now(), folder: frame.folder };
  return { ...frame, view };
  } catch (e) { await discardFrame(frame); throw e; }
}
async function selectDevice(signal) {
  const d = new Device(null, signal);
  const ids = await d.targets();
  if (ids.length !== 1) throw new Error(ids.length ? '检测到多台设备，请只保留一台手机连接' : '未检测到手机，请连接USB并开启USB调试，在手机上允许电脑调试');
  return new Device(ids[0], signal);
}
async function run(options) {
  state.running = true; state.done = 0; aborter = new AbortController();
  const signal = aborter.signal;
  try {
    const device = await selectDevice(signal);
    const flow = new Flow(options);
    log('已连接，3秒后开始，请保持淘宝在前台、手机解锁且竖屏');
    await sleep(3000, undefined, { signal });
    while (true) {
      signal.throwIfAborted();
      const frame = await observe(device);
      const action = flow.step(frame.view);
      state.done = flow.done; log(action.reason);
      if (action.kind === 'stop') break;
      signal.throwIfAborted();
      if (action.kind === 'click') {
        const p = center(action.target);
        await device.input('click', p.x, p.y);
      } else if (action.kind === 'back') await device.input('keyEvent', 'Back');
      else if (action.kind === 'swipe' || action.kind === 'taskScroll') {
        // Finger moves upward to reveal products below. Stay clear of top banner/bottom controls.
        const x = Math.round(frame.width * .55);
        await device.input('swipe', x, Math.round(frame.height * .76), x,
          Math.round(frame.height * (action.kind === 'taskScroll' ? .43 : .38)), 600);
      }
      await sleep(action.kind === 'click' || action.kind === 'back' ? 2400 : 1000, undefined, { signal });
    }
  } catch (e) { log(signal.aborted ? '已停止' : `已停止：${e.message}`); }
  finally { state.running = false; aborter = null; }
}
function options(body) {
  const result = {};
  for (const [k, fallback, lo, hi] of [['maxTasks', 40, 1, 100], ['taskTimeout', 65, 20, 180], ['maxMinutes', 30, 1, 120]]) {
    const n = body[k] ?? fallback;
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${k} 必须在 ${lo}～${hi} 之间`);
    result[k] = n;
  }
  return result;
}
await mkdir(runtime, { recursive: true });
const server = http.createServer(async (req, res) => {
  const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return send(403, { error: 'Invalid host' });
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(await readFile(path.join(root, 'public', 'index.html')));
    }
    if (req.method === 'GET' && req.url === '/api/state') return send(200, { ...state, hdc: hdcPath() });
    if (req.method === 'GET' && req.url?.startsWith('/screen.png')) {
      if (!preview.data) { res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return res.end(preview.data);
    }
    if (req.method !== 'POST') return send(404, { error: 'Not found' });
    if (![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin) ||
      !req.headers['content-type']?.startsWith('application/json')) return send(403, { error: '请通过本机工具页面操作' });
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2048) throw new Error('请求过大'); }
    const body = JSON.parse(raw || '{}');
    if (req.url === '/api/stop') { aborter?.abort(); return send(200, { ok: true }); }
    if (state.running || state.busy) return send(409, { error: '操作正在进行，请先停止或等待检测完成' });
    if (req.url === '/api/start') { const opts = options(body); void run(opts); return send(200, { ok: true }); }
    if (req.url === '/api/probe') {
      state.busy = true;
      try {
        const device = await selectDevice();
        const frame = await observe(device);
        log(`连接成功，${frame.width}×${frame.height}，识别页面：${frame.view.page}（仅检测，未点击）`);
        return send(200, { ok: true });
      } finally { state.busy = false; }
    }
    send(404, { error: 'Not found' });
  } catch (e) { log(e.message); send(400, { error: e.message }); }
});
server.listen(port, '127.0.0.1', () => log(`工具已启动：http://127.0.0.1:${port}`));
server.on('error', e => { console.error(e.message); process.exitCode = 1; });
process.on('SIGINT', () => { aborter?.abort(); server.close(); });
