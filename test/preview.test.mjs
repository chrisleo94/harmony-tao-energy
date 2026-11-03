import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Device, discardFrame } from '../src/device.mjs';
import { Preview } from '../src/preview.mjs';

function png() {
  const data = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a','hex').copy(data);
  data.writeUInt32BE(1308,16);data.writeUInt32BE(2880,20);
  return data;
}

test('preview stays available while next transfer is incomplete; captures never overwrite a reader file', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(),'tao-preview-test-'));
  class FakeDevice extends Device {
    constructor() { super('test'); this.folder = folder; }
    async hdc(args) {
      if(args[0] !== 'file') return '';
      if(args[2].endsWith('.png')) {
        await this.duringTransfer?.();
        await writeFile(args[3],png());
      } else await writeFile(args[3],'{}');
      return '';
    }
  }
  const device = new FakeDevice(), preview = new Preview();
  let first, second;
  try {
    first=await device.capture(); await preview.publish(first);
    const browserResponse = preview.data;
    device.duringTransfer = async () => {
      assert.equal(preview.data,browserResponse);
      assert.deepEqual(await readFile(first.png),browserResponse);
      // Model many preview requests during HDC receive; none read the changing file.
      for(let i=0;i<100;i++) assert.deepEqual(preview.data,png());
    };
    second=await device.capture();
    assert.notEqual(first.png,second.png);
    assert.deepEqual(await readFile(first.png),browserResponse);
    await preview.publish(second);
    assert.deepEqual(browserResponse,png(),'in-flight old response survives file cleanup');
    assert.deepEqual(preview.data,png());
  } finally {
    await discardFrame(first); await discardFrame(second); await rmdir(folder);
  }
});
