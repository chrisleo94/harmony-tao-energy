import test from 'node:test';
import assert from 'node:assert/strict';
import { Flow, inspect, parseLayout, bounds } from '../src/recognition.mjs';
const n = (text, x, y, w=300, h=50) => ({text,left:x,top:y,right:x+w,bottom:y+h});
const screen = nodes => inspect(nodes,1308,2880);
const taskNodes = [n('做任务赚能量',440,580),n('好物随心逛(4/10)',240,1000,600),
  n('浏览15秒 +400',240,1080),n('去完成',1060,1040,160),
  n('邀请好友',240,1710),n('去完成',1060,1730,160),
  n('天猫积分换能量(0/3)',240,1960),n('去兑换',1060,1970,160),
  n('去玩趣味小游戏',240,2200),n('去完成',1060,2210,160)];
const browse = screen([n('浏览15秒可领400',620,200,600)]);
const complete = screen([n('已得400 | 下单再得2000',360,200,860),n('下 个 任 务',35,2560,210)]);

test('only select 15-second browse rows; skip invitation, exchange and games',()=>{
  const v=screen(taskNodes); assert.equal(v.page,'tasks'); assert.equal(v.tasks.length,1);
  assert.match(v.tasks[0].label,/好物/);
});
test('completed counter excludes finished tasks',()=>{
  const v=screen(taskNodes.map(a=>({...a,text:a.text.replace('4/10','10/10')})));
  assert.equal(v.tasks.length,0);
});
test('browse continuously, then always return via coins homepage even with a next-task button',()=>{
  const f=new Flow({},0);
  assert.equal(f.step(screen(taskNodes),0).kind,'click');
  assert.equal(f.step(browse,1000).kind,'swipe');
  assert.equal(f.step(browse,16000).kind,'swipe');
  assert.equal(f.step(complete,18000).kind,'back'); assert.equal(f.done,1);
  assert.equal(f.step(complete,19000).kind,'wait'); assert.equal(f.done,1);
  assert.equal(f.step(screen(taskNodes),21000).kind,'back');
  assert.equal(f.step({page:'energy',target:{}},24000).kind,'click');
  assert.equal(f.step(screen(taskNodes),27000).kind,'click');
  assert.equal(f.step(browse,30000).kind,'swipe');
  assert.equal(f.step({...complete,next:undefined},39000).kind,'back');assert.equal(f.done,2);
});
test('never count or navigate from elapsed time alone',()=>{
  const f=new Flow({},0);f.step(browse,0);
  assert.equal(f.step(browse,30000).kind,'swipe');
  assert.equal(f.step(browse,66000).kind,'stop'); assert.equal(f.done,0);
});
test('unknown, verification, max count and unchanged navigation stop safely',()=>{
  const f=new Flow({},0);for(let i=0;i<3;i++)assert.equal(f.step({page:'unknown'},i).kind,'wait');
  assert.equal(f.step({page:'unknown'},4).kind,'stop');
  assert.equal(new Flow({},0).step(screen([n('安全验证',10,300)]),0).kind,'stop');
  const limited=new Flow({maxTasks:1},0);limited.step(browse,0);
  assert.equal(limited.step(complete,17000).kind,'back');assert.equal(limited.done,1);
  assert.equal(limited.step({page:'tasks',tasks:[]},19000).kind,'back');
  assert.equal(limited.step({page:'energy',target:{}},22000).kind,'stop');
  const stale=new Flow({},0);stale.step(complete,0);
  assert.equal(stale.step(complete,17000).kind,'stop');assert.equal(stale.done,0);
});
test('do not confuse product text for task completion',()=>{
  assert.equal(screen([n('已得400',100,800),n('下个任务',30,2560)]).page,'unknown');
});
test('layout parser accepts normal dump bounds and ignores invisible nodes',()=>{
  assert.deepEqual(bounds('[0,1][200,300]'),{left:0,top:1,right:200,bottom:300});
  assert.equal(parseLayout({children:[{attributes:{text:'测试',bounds:'[0,1][200,300]'}},
    {attributes:{text:'隐藏',bounds:'[0,1][200,300]',visible:'false'}}]}).length,1);
});
test('unchanged task progress and no browse tasks have bounded retries',()=>{
  const f=new Flow({},0),tasks=screen(taskNodes);
  f.step(tasks,0);f.step(tasks,1);assert.equal(f.step(tasks,2).kind,'stop');
  const empty=new Flow({},0);for(let i=0;i<3;i++)assert.equal(empty.step({page:'tasks',tasks:[]},i).kind,'taskScroll');
  assert.equal(empty.step({page:'tasks',tasks:[]},4).kind,'stop');
});
