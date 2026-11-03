import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect, Flow } from '../src/recognition.mjs';

const searchNodes = JSON.parse(await readFile(new URL('./fixtures/search.json', import.meta.url), 'utf8'));
const inactiveNodes = JSON.parse(await readFile(new URL('./fixtures/inactive.json', import.meta.url), 'utf8'));
const search = inspect(searchNodes, 1308, 2880);
const inactive = inspect(inactiveNodes, 1308, 2880);
const tasks = { page:'tasks', tasks:[{ key:'browse(1/10)', label:'浏览15秒', button:{} }] };

test('logged failure: completion -> back -> search must back again instead of reopening a finished product', () => {
  const f = new Flow({}, 0);
  assert.equal(f.step(search, 0).kind, 'click');
  assert.equal(f.step({ page:'browse' }, 5000).kind, 'swipe');
  assert.equal(f.step({ page:'complete' }, 23000).kind, 'back');
  assert.equal(f.step(search, 30000).kind, 'back');
  assert.equal(f.done, 1);
  assert.equal(f.step(tasks, 37000).kind, 'back');
  assert.equal(f.step({page:'energy',target:{}}, 39000).kind, 'click');
  assert.equal(f.step(tasks, 41000).kind, 'click');
  assert.equal(f.step(search, 44000).kind, 'click', 'a genuinely new task may enter search again');
});

test('saved real failure layout: purchase-only header is recoverable, never counted as completion', () => {
  assert.equal(inactive.page, 'inactive');
  const f = new Flow({}, 0);
  assert.equal(f.step(inactive, 0).kind, 'back');
  assert.equal(f.step(search, 7000).kind, 'back');
  assert.equal(f.step(tasks, 14000).kind, 'back');
  assert.equal(f.step({page:'energy',target:{}}, 17000).kind, 'click');
  assert.equal(f.step(tasks, 20000).kind, 'click');
  assert.equal(f.done, 0);
});

test('return recovery survives a loading frame and has a bounded back limit', () => {
  const f = new Flow({}, 0);
  f.step({ page:'browse' }, 0); f.step({ page:'complete' }, 20000);
  assert.equal(f.step({ page:'unknown' }, 25000).kind, 'wait');
  for (let i=0;i<5;i++) assert.equal(f.step(search, 30000+i*3000).kind, 'back');
  assert.equal(f.step(search, 46000).kind, 'stop');
  assert.equal(f.done, 1);
});

test('large WebView containers do not poison header or task-row progress', () => {
  const n = (text,left,top,right,bottom) => ({text,left,top,right,bottom});
  const nodes = [n('做任务赚能量',440,580,850,650),
    n('明日领 O1CN-resource 好物随心逛(0/10)浏览15秒+400',0,0,1308,2880),
    n('好物随心逛(10/10)',240,1000,840,1050), n('浏览15秒+400',240,1080,600,1130),
    n('去完成',1060,1040,1220,1090)];
  const view = inspect(nodes,1308,2880);
  assert.equal(view.page,'tasks'); assert.equal(view.tasks.length,0);
  assert.equal(inspect([n('已得400',0,0,1308,2880)],1308,2880).page,'unknown');
});

test('many rounds must revisit coins homepage without exhausting entry navigation retries', () => {
  const f = new Flow({}, 0);
  for (let i=0;i<10;i++) {
    const now = i*40000;
    const task = {page:'tasks',tasks:[{key:`task(${i}/10)`,label:'浏览15秒',button:{}}]};
    assert.equal(f.step({page:'energy',target:{}},now).kind,'click');
    assert.equal(f.step(task,now+3000).kind,'click');
    assert.equal(f.step({page:'browse'},now+6000).kind,'swipe');
    assert.equal(f.step({page:'complete',next:{}},now+24000).kind,'back');
    assert.equal(f.step(task,now+27000).kind,'back', 'do not launch another task before the homepage');
    assert.equal(f.done,i+1);
    // The next iteration returns to the homepage and reopens the list.
  }
});
