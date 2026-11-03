import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect } from '../src/recognition.mjs';

test('recognize Windows OCR extracted from all five supplied screenshots',async()=>{
  const fixture = JSON.parse(await readFile(new URL('./fixtures/screenshots.json',import.meta.url),'utf8'));
  for (const [name, expected] of Object.entries({home:'home',energy:'energy',task:'tasks',browse:'browse',complete:'complete'})) {
    const view=inspect(fixture[name],1308,2880);
    assert.equal(view.page,expected,name);
    if(name==='home')assert.ok(view.target.right<300,'home shortcut must not include adjacent farm shortcut');
    if(name==='task')assert.equal(view.tasks.length,3);
    if(name==='complete')assert.ok(view.next);
  }
});
