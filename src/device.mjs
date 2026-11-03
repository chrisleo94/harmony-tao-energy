import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLayout } from './recognition.mjs';
const exec = promisify(execFile);
export const root = fileURLToPath(new URL('../', import.meta.url));
export const runtime = path.join(root, 'runtime');
export function hdcPath() {
  const candidates = [process.env.HDC_PATH, 'D:/Program Files/Huawei/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe',
    'C:/Program Files/Huawei/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe'];
  return candidates.find(p => p && existsSync(p)) || 'hdc';
}
export class Device {
  constructor(id, signal) { this.id = id; this.signal = signal; this.folder = path.join(runtime, 'current'); }
  async hdc(args) {
    this.signal?.throwIfAborted();
    const { stdout, stderr } = await exec(hdcPath(), [...(this.id ? ['-t', this.id] : []), ...args],
      { windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024, signal: this.signal });
    const out = stdout + stderr;
    if (/\[Fail\]|error:|not found|permission denied|device.*offline/i.test(out)) throw new Error(out.trim().slice(0, 400));
    return out;
  }
  async targets() {
    const out = await this.hdc(['list', 'targets']);
    return out.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('['));
  }
  async input(...args) { return this.hdc(['shell', 'uitest', 'uiInput', ...args.map(String)]); }
  async capture() {
    await mkdir(this.folder, { recursive: true });
    const folder = await mkdtemp(path.join(this.folder, 'frame-'));
    const png = path.join(folder, 'screen.png');
    const json = path.join(folder, 'layout.json');
    // Each capture has exclusive files. Preview/OCR readers never share a file
    // with the next HDC transfer, even while a browser is requesting a preview.
    const frame = { folder, png, json };
    try {
    await this.hdc(['shell', 'uitest', 'screenCap', '-p', '/data/local/tmp/tao_energy_screen.png']);
    await this.hdc(['file', 'recv', '/data/local/tmp/tao_energy_screen.png', png]);
    const data = await readFile(png);
    if (data.length < 24 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('设备截图不是PNG，无法识别');
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    if (width >= height) throw new Error('请保持手机竖屏');
    let nodes = [], warning = '';
    try {
      await this.hdc(['shell', 'uitest', 'dumpLayout', '-p', '/data/local/tmp/tao_energy_layout.json']);
      await this.hdc(['file', 'recv', '/data/local/tmp/tao_energy_layout.json', json]);
      nodes = parseLayout(JSON.parse((await readFile(json, 'utf8')).replace(/^\uFEFF/, '')));
    } catch (e) { warning = `控件树不可用：${e.message}`; }
    return { ...frame, data, width, height, nodes, warning };
    } catch (e) { await discardFrame(frame); throw e; }
  }
  async ocr(png) {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(root, 'scripts', 'ocr.ps1'), '-ImagePath', png], {
      windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, signal: this.signal
    });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  }
}

export async function discardFrame(frame) {
  if (!frame) return;
  // Nonrecursive removal is limited to these two generated files and their directory.
  await Promise.allSettled([rm(frame.png, { force: true }), rm(frame.json, { force: true })]);
  await rmdir(frame.folder).catch(() => {});
}
