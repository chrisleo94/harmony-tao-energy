export const clean = s => String(s ?? '').replace(/\s+/g, '');

export function bounds(value) {
  if (typeof value === 'string') {
    try { const obj = JSON.parse(value); if (typeof obj === 'object') return bounds(obj); } catch {}
    const a = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (a?.length === 4) return { left: a[0], top: a[1], right: a[2], bottom: a[3] };
  }
  if (value && ['left', 'top', 'right', 'bottom'].every(k => Number.isFinite(Number(value[k]))))
    return Object.fromEntries(['left', 'top', 'right', 'bottom'].map(k => [k, Number(value[k])]));
  return null;
}

export function parseLayout(tree) {
  const nodes = [];
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    const a = n.attributes ?? n;
    const text = a.text || a.content || a.description || a.accessibilityText;
    const b = bounds(a.bounds ?? a.rect);
    if (text && b && b.right > b.left && b.bottom > b.top && a.visible !== false && a.visible !== 'false')
      nodes.push({ text: String(text), ...b });
    for (const [k, v] of Object.entries(n)) if (k !== 'attributes' && typeof v === 'object') {
      if (Array.isArray(v)) v.forEach(walk); else walk(v);
    }
  }
  walk(tree);
  return nodes;
}

export const center = n => ({ x: Math.round((n.left + n.right) / 2), y: Math.round((n.top + n.bottom) / 2) });

export function inspect(nodes, width, height) {
  nodes = nodes.filter(n => n.left >= 0 && n.top >= 0 && n.right <= width + 2 && n.bottom <= height + 2);
  const text = nodes.map(n => clean(n.text)).join('\n');
  // Only the orange header is evidence of a browsing task/completion.
  const header = nodes.filter(n => n.bottom < height * .13).map(n => clean(n.text)).join('');
  const next = nodes.find(n => /^下(?:一)?个任务[>›»〉]?$/u.test(clean(n.text)) && n.left < width * .35 && n.top > height * .65);
  if (/安全验证|滑块验证|拖动滑块|请先登录|登录淘宝|账号异常|风险提示/.test(text)) return { page: 'blocked', text };
  if (/已得/.test(header) && /400|能量/.test(header)) return { page: 'complete', next, text };
  if (/浏览\d{1,2}秒可领/.test(header)) return { page: 'browse', text };
  // Reopening a completed search can leave only the purchase reward in the banner.
  // It is not an active browsing task, and must never count as a new completion.
  if (/下单再得/.test(header) && /2000/.test(header)) return { page: 'inactive', text };
  if (/搜索有福利/.test(header) && /搜索后浏览立得奖励/.test(header)) {
    const heading = nodes.find(n => /^(搜索|探索)发现$/.test(clean(n.text)));
    // Select a title below the discovery heading with a matching card subtitle.
    // History chips above it, captions and container-sized nodes are excluded.
    const titles = heading ? nodes.filter(n => {
      const label = clean(n.text);
      if (n.top < heading.bottom || n.bottom > height * .96 || n.bottom - n.top > height * .035 ||
          !label || label.length > 20 || /^(近一个月|行业|成交|搜索近|搜索发现|探索发现)/.test(label)) return false;
      return nodes.some(caption => caption.top >= n.bottom && caption.top - n.bottom < height * .025 &&
        Math.abs(caption.left - n.left) < width * .05 &&
        /^(近一个月|行业|成交近|搜索近)/.test(clean(caption.text)));
    }).sort((a, b) => Math.abs(a.top - b.top) < height * .012 ? a.left - b.left : a.top - b.top) : [];
    return { page: 'search', target: titles[0], text };
  }
  if (/做任务赚能量/.test(text)) {
    const buttons = nodes.filter(n => /^去完成$/.test(clean(n.text)) && n.left > width * .65)
      .filter((n, i, all) => all.findIndex(other => Math.abs(center(other).y - center(n).y) < height * .015) === i);
    const tasks = [];
    for (const button of buttons) {
      const cy = center(button).y;
      // Match the description in the same row; never choose invitation/exchange/game rows.
      const row = nodes.filter(n => n.left < width * .74 && n.right < width * .8 &&
        n.bottom - n.top < height * .09 && Math.abs(center(n).y - cy) < height * .034 &&
        clean(n.text).length < 120 && !/O1CN|tps-\d/.test(n.text));
      const label = [...new Set(row.map(n => clean(n.text)))].join(' ');
      if (!/浏览15秒/.test(label) || /邀请|兑换|下单|购买|小游戏|拉1人/.test(label)) continue;
      const progress = label.match(/[(（](\d+)\/(\d+)[)）]/);
      if (progress && Number(progress[1]) >= Number(progress[2])) continue;
      tasks.push({ button, label, key: label.replace(/浏览15秒.*$/, '') });
    }
    return { page: 'tasks', tasks: tasks.sort((a, b) => a.button.top - b.button.top), text };
  }
  const energy = nodes.find(n => clean(n.text) === '去赚能量');
  if (energy) return { page: 'energy', target: energy, text };
  const coins = nodes.find(n => clean(n.text) === '领淘金币');
  if (coins) return { page: 'home', target: coins, text };
  return { page: 'unknown', text };
}

// Pure controller: actions only occur on positively recognized pages.
export class Flow {
  constructor({ maxTasks = 40, taskTimeout = 65, maxMinutes = 30 } = {}, now = Date.now()) {
    this.maxTasks = maxTasks; this.taskTimeout = taskTimeout * 1000;
    this.deadline = now + maxMinutes * 60000; this.done = 0;
    this.browsingSince = null; this.awaitingTransition = null; this.lastTask = null;
    this.repeats = 0; this.emptyScans = 0; this.unknown = 0; this.navigationAttempts = 0;
    this.searchClickedAt = null; this.searchMisses = 0;
    this.returningToHome = false; this.returnSteps = 0;
  }
  step(view, now = Date.now()) {
    if (now >= this.deadline) return { kind: 'stop', reason: '达到总运行时限' };
    if (this.done >= this.maxTasks && !this.returningToHome) return { kind: 'stop', reason: '达到本轮任务上限' };
    if (view.page === 'blocked') return { kind: 'stop', reason: '检测到登录或验证页面，请人工处理' };
    if (this.awaitingTransition !== null) {
      if (view.page === 'complete') {
        if (now - this.awaitingTransition > 16000) return { kind: 'stop', reason: '点击或返回后页面未变化，请检查手机' };
        return { kind: 'wait', reason: '等待下一页加载' };
      }
      this.awaitingTransition = null;
    }
    if (view.page !== 'unknown') this.unknown = 0;
    if (view.page === 'inactive') this.returningToHome = true;
    if (this.returningToHome && view.page === 'energy') {
      this.returningToHome = false; this.returnSteps = 0;
      this.navigationAttempts = 0; this.emptyScans = 0;
      this.searchClickedAt = null; this.searchMisses = 0;
      if (this.done >= this.maxTasks) return { kind: 'stop', reason: '已返回淘金币首页，达到本轮任务上限' };
      return { kind: 'click', target: view.target, reason: '已返回淘金币首页，重新进入赚能量任务列表' };
    }
    if (this.returningToHome && ['search', 'tasks', 'inactive', 'browse'].includes(view.page)) {
      this.browsingSince = null;
      if (++this.returnSteps > 6) return { kind: 'stop', reason: '返回淘金币首页超过重试次数，请检查手机' };
      return { kind: 'back', reason: view.page === 'tasks' ? '关闭任务列表，继续返回淘金币首页' : '继续返回淘金币首页' };
    }
    if (view.page !== 'search' && view.page !== 'unknown') {
      this.searchClickedAt = null; this.searchMisses = 0;
    }
    if (view.page === 'search') {
      this.browsingSince = null;
      if (this.searchClickedAt !== null) {
        if (now - this.searchClickedAt > 16000) return { kind: 'stop', reason: '点击搜索发现商品后页面未变化，请检查手机' };
        return { kind: 'wait', reason: '等待搜索商品浏览页加载' };
      }
      if (!view.target) {
        if (++this.searchMisses >= 3) return { kind: 'stop', reason: '未识别到搜索发现商品，请人工选择后重试' };
        return { kind: 'wait', reason: '等待搜索发现商品显示' };
      }
      this.searchClickedAt = now;
      return { kind: 'click', target: view.target, reason: `点击搜索发现商品：${clean(view.target.text)}` };
    }
    if (view.page === 'browse') {
      this.emptyScans = 0;
      this.browsingSince ??= now;
      if (now - this.browsingSince > this.taskTimeout) return { kind: 'stop', reason: '浏览任务超时，未识别到完成提示' };
      return { kind: 'swipe', reason: '向上滑动，继续浏览商品' };
    }
    if (view.page === 'complete') {
      // A completion already on screen at startup is navigable, but is not counted.
      if (this.browsingSince !== null) this.done++;
      this.browsingSince = null; this.awaitingTransition = now;
      this.returningToHome = true; this.returnSteps = 1;
      return { kind: 'back', reason: '任务已完成，返回淘金币首页后重新进入任务列表' };
    }
    if (view.page === 'tasks') {
      this.browsingSince = null;
      const task = view.tasks[0];
      if (task) {
        this.emptyScans = 0;
        this.repeats = this.lastTask === task.key ? this.repeats + 1 : 0;
        this.lastTask = task.key;
        if (this.repeats >= 2) return { kind: 'stop', reason: '同一任务进度未变化，停止重复尝试' };
        return { kind: 'click', target: task.button, reason: `进入浏览任务：${task.label}` };
      }
      if (++this.emptyScans > 3) return { kind: 'stop', reason: '当前任务列表没有可识别的15秒浏览任务' };
      return { kind: 'taskScroll', reason: '查找下面的浏览任务' };
    }
    if (view.page === 'home' || view.page === 'energy') {
      this.browsingSince = null;
      if (this.returningToHome && ++this.returnSteps > 6) return { kind: 'stop', reason: '返回淘金币首页超过重试次数，请检查手机' };
      if (++this.navigationAttempts > 6) return { kind: 'stop', reason: '入口跳转失败' };
      return { kind: 'click', target: view.target, reason: view.page === 'home' ? '进入领淘金币' : '进入赚能量任务列表' };
    }
    if (++this.unknown >= 4) return { kind: 'stop', reason: '连续无法识别页面，请手动打开任务列表后重试' };
    return { kind: 'wait', reason: '等待页面加载或文字识别' };
  }
}
