import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspect, Flow, clean } from '../src/recognition.mjs';

const nodes = JSON.parse(await readFile(new URL('./fixtures/search.json', import.meta.url), 'utf8'));
const search = inspect(nodes, 1308, 2880);
const browse = { page: 'browse' };
const complete = { page: 'complete', next: { text: '下个任务' } };

test('actual screenshot: select coffee machine below discovery, not history search', () => {
  assert.equal(search.page, 'search');
  assert.equal(clean(search.target.text), '咖啡机');
  assert.ok(search.target.top > 1028);
  assert.ok(search.target.right < 654);
});

test('recognition follows discovery layout with changed product names and resolution', () => {
  const changed = nodes.map(n => ({ ...n, text: n.text === search.target.text ? '收纳盒' : n.text }));
  assert.equal(inspect(changed, 1308, 2880).target.text, '收纳盒');
  const scaled = changed.map(n => ({ ...n, left:n.left/2, top:n.top/2, right:n.right/2, bottom:n.bottom/2 }));
  assert.equal(inspect(scaled, 654, 1440).target.text, '收纳盒');
  const alias = changed.map(n => ({ ...n, text: clean(n.text) === '搜索发现' ? '探索发现' : n.text }));
  assert.equal(inspect(alias, 1308, 2880).target.text, '收纳盒');
});

test('ordinary search without reward banner does not trigger automatic selection', () => {
  const normal = nodes.filter(n => !clean(n.text).includes('搜索后浏览立得奖励'));
  assert.equal(inspect(normal, 1308, 2880).page, 'unknown');
});

test('search -> browse -> completion -> search -> tasks -> coins homepage -> new task', () => {
  const flow = new Flow({}, 0);
  const click = flow.step(search, 0);
  assert.equal(click.kind, 'click'); assert.equal(click.target, search.target);
  assert.equal(flow.step(search, 2000).kind, 'wait');
  assert.equal(flow.done, 0);
  assert.equal(flow.step(browse, 4000).kind, 'swipe');
  assert.equal(flow.step(complete, 21000).kind, 'back'); assert.equal(flow.done, 1);
  assert.equal(flow.step(search, 24000).kind, 'back');
  const tasks = {page:'tasks',tasks:[{button:{},label:'浏览15秒',key:'task'}]};
  assert.equal(flow.step(tasks, 27000).kind, 'back');
  assert.equal(flow.step({page:'energy',target:{}}, 30000).kind, 'click');
  assert.equal(flow.step(tasks, 33000).kind, 'click');
  assert.equal(flow.step(search, 36000).kind, 'click');
  assert.equal(flow.step(browse, 39000).kind, 'swipe');
  assert.equal(flow.step({ page:'complete' }, 44000).kind, 'back');
  assert.equal(flow.done, 2);
});

test('missing discovery product or stalled transition stops without repeated clicks', () => {
  const missing = inspect(nodes.filter(n => n.top < 1050), 1308, 2880);
  assert.equal(missing.page, 'search'); assert.equal(missing.target, undefined);
  const flow = new Flow({}, 0);
  assert.equal(flow.step(missing, 0).kind, 'wait');
  assert.equal(flow.step(missing, 2000).kind, 'wait');
  assert.equal(flow.step(missing, 4000).kind, 'stop');
  const stalled = new Flow({}, 0);
  stalled.step(search, 0);
  assert.equal(stalled.step(search, 17000).kind, 'stop');
  assert.equal(stalled.done, 0);
});
