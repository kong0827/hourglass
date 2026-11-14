/* 真实本地 API 回归：用例查询批次A + 目录归类 + 自定义分组 + 按筛选圈选 + 批次C 动态分组/指定成员/分组进证据。
 * 运行：E2E_ADMIN_PASS=<密码> E2E_VIEWER_PASS=<密码> node tools/e2e/case-query-api.mjs
 * 可选 E2E_BASE，默认 http://127.0.0.1:8095/hourglass（只允许本机回环）。
 * 可选 E2E_OUTSIDER_USER / E2E_OUTSIDER_PASS（默认 lina，密码同 VIEWER_PASS）：空间成员但不在分组可见名单里。
 * 只新建一个临时共享空间，finally 删除；不切换 lastWorkspaceId，不写演示空间。
 * K 组建版本与交付说明快照后空间删不掉（version_log 是不可销毁的审计历史，产品禁止清空），
 * 脚本打印 TEMP_WORKSPACE_KEPT <id> 并正常退出；手工收尾：先按该 id 清 version_log，再调 DELETE /api/workspaces/<id>。
 * 后端要求 workspace 查询参数（X-Workspace-Id 头不被 WorkspaceArgumentResolver 采用）。
 */
import assert from 'node:assert/strict';

const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8095/hourglass').replace(/\/+$/, '');
const baseUrl = new URL(BASE);
assert.equal(baseUrl.hostname, '127.0.0.1', '只允许本机回环地址');
assert.equal(baseUrl.pathname, '/hourglass');
const ADMIN_USER = process.env.E2E_ADMIN_USER || 'admin';
const VIEWER_USER = process.env.E2E_VIEWER_USER || 'wujun';
const OUTSIDER_USER = process.env.E2E_OUTSIDER_USER || 'lina';
const ADMIN_PASS = process.env.E2E_ADMIN_PASS;
const VIEWER_PASS = process.env.E2E_VIEWER_PASS;
const OUTSIDER_PASS = process.env.E2E_OUTSIDER_PASS || VIEWER_PASS;
if (!ADMIN_PASS || !VIEWER_PASS) throw new Error('需要 E2E_ADMIN_PASS 与 E2E_VIEWER_PASS 环境变量');
const PROTECTED = 'Smw9zcftmwwnrwuon';
const stamp = Date.now().toString(36);
const workspaceName = '用例查询验证-' + stamp;
let workspace = null, assertions = 0, apiChecks = 0;
const errors = [], groups = [], writes = [];
let activeGroup = 'preflight';

function check(condition, message, actual, api = false) {
  assertions++;
  if (api) apiChecks++;
  assert.ok(condition, `${activeGroup}: ${message}${actual === undefined ? '' : ' | ' + JSON.stringify(actual)}`);
}
function eq(actual, expected, message) {
  assertions++;
  assert.deepEqual(actual, expected, `${activeGroup}: ${message}`);
}
function guard(method, url, payload) {
  if (method === 'GET') return;
  if (url.pathname.endsWith('/api/auth/login')) return;
  if (method === 'POST' && url.pathname.endsWith('/api/workspaces')) {
    assert.equal(payload.name, workspaceName);
    assert.equal(workspace, null, '只允许新建一个临时空间');
    return;
  }
  assert.ok(workspace && workspace.id !== PROTECTED, '必须先有自己新建的临时空间');
  assert.ok(!url.pathname.includes(PROTECTED) && url.searchParams.get('workspace') !== PROTECTED,
    '禁止写演示空间');
  const prefix = baseUrl.pathname + '/api/workspaces/' + workspace.id;
  assert.ok(url.pathname === prefix || url.pathname.startsWith(prefix + '/')
    || url.searchParams.get('workspace') === workspace.id,
    '临时空间之外的写操作被拦截: ' + url.pathname);
  assert.ok(!url.pathname.endsWith('/select'), '不切换 lastWorkspaceId');
  writes.push({method, path: url.pathname});
}
class Session {
  constructor(username) { this.username = username; this.cookies = new Map(); this.me = null; }
  async request(method, endpoint, payload, ws = null, params = {}) {
    const url = new URL(BASE + endpoint);
    if (ws) url.searchParams.set('workspace', ws);
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, v);
      else url.searchParams.set(key, value);
    }
    guard(method, url, payload);
    const headers = {Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')};
    if (ws) headers['X-Workspace-Id'] = ws;
    let body;
    if (payload !== undefined) {
      const login = endpoint === '/api/auth/login';
      headers['Content-Type'] = login ? 'application/x-www-form-urlencoded' : 'application/json';
      body = login ? new URLSearchParams(payload).toString() : JSON.stringify(payload);
    }
    if (method !== 'GET') headers['X-XSRF-TOKEN'] = decodeURIComponent(this.cookies.get('XSRF-TOKEN') || '');
    const res = await fetch(url, {method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30000)});
    for (const cookie of res.headers.getSetCookie()) {
      const [kv] = cookie.split(';'), i = kv.indexOf('=');
      this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const hasBom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
    const text = new TextDecoder('utf-8').decode(buf);
    let envelope;
    try { envelope = JSON.parse(text); } catch { envelope = {code: -1, message: text.slice(0, 300)}; }
    if (envelope.code === 0 && method === 'POST' && endpoint === '/api/workspaces') workspace = envelope.data;
    return {status: res.status, text, hasBom, headers: Object.fromEntries(res.headers), ...envelope};
  }
  async api(method, endpoint, payload, ws = null, params = {}) {
    const r = await this.request(method, endpoint, payload, ws, params);
    check(r.status === 200 && r.code === 0, `${method} ${endpoint} 成功`, r, true);
    return r.data;
  }
  async reject(method, endpoint, payload, code, ws = workspace.id, params = {}) {
    const r = await this.request(method, endpoint, payload, ws, params);
    check(r.code === code, `${method} ${endpoint} 返回 ${code}`, {code: r.code, message: r.message}, true);
    return r;
  }
  async login(password) {
    await this.request('GET', '/login.html');
    if (!this.cookies.has('XSRF-TOKEN')) await this.api('GET', '/api/health');
    check(this.cookies.has('XSRF-TOKEN'), '登录前拿到 CSRF cookie');
    await this.api('POST', '/api/auth/login', {username: this.username, password});
    this.me = await this.api('GET', '/api/auth/me');
    eq(this.me.username, this.username, '登录到预期账号');
  }
}
const admin = new Session(ADMIN_USER), viewer = new Session(VIEWER_USER), outsider = new Session(OUTSIDER_USER);
const get = (endpoint, params = {}) => admin.api('GET', endpoint, undefined, workspace.id, params);
const post = (endpoint, body) => admin.api('POST', endpoint, body, workspace.id);
const put = (endpoint, body) => admin.api('PUT', endpoint, body, workspace.id);
const del = endpoint => admin.api('DELETE', endpoint, undefined, workspace.id);
const wsPath = suffix => `/api/workspaces/${workspace.id}${suffix}`;
const vget = (endpoint, params = {}) => viewer.api('GET', endpoint, undefined, workspace.id, params);
const oget = (endpoint, params = {}) => outsider.api('GET', endpoint, undefined, workspace.id, params);

async function group(name, run) {
  activeGroup = name;
  const before = assertions;
  try {
    await run();
    groups.push({name, status: 'pass', assertions: assertions - before});
    console.log(`PASS ${name}: ${assertions - before} 断言`);
  } catch (error) {
    const evidence = {group: name, message: error.message, actual: error.actual, expected: error.expected};
    errors.push(evidence);
    groups.push({name, status: 'fail', assertions: assertions - before});
    console.error('FAIL', JSON.stringify(evidence));
  }
}

/* ---------- 固定数据 ---------- */
let p1, p2, d1, d2, plan;
let mA, mB, mC, mD, mE;                 // 账号体系 / 登录 / 验证码 / 对账 / 空目录
const c = {};                            // c1..c12 + x1（跨项目）
let setTeam, setPersonal;
const MARK = 'ZZQMARK';
const ids = keys => keys.map(k => c[k].id);
const titles = rows => rows.map(r => r.title);
const keyOf = rows => rows.map(r => Object.keys(c).find(k => c[k].id === r.id));
const eqKeys = (rows, expected, message) => eq(keyOf(rows).sort(), [...expected].sort(), message);
const seg = (list, key) => list.find(g => g.key === key);
const counts = list => Object.fromEntries(list.map(g => [g.key, g.total]));

async function fixture() {
  await admin.api('POST', '/api/workspaces', {name: workspaceName});
  check(workspace.id !== PROTECTED && workspace.name === workspaceName, '临时空间已创建');
  console.log('TEMP_WORKSPACE', JSON.stringify({id: workspace.id, name: workspace.name}));
  p1 = (await post('/api/projects', {name: `查询验证-${stamp}-支付`, template: 'blank'})).id;
  p2 = (await post('/api/projects', {name: `查询验证-${stamp}-风控`, template: 'blank'})).id;
  // 执行人必须是空间成员：先入空间再录执行流水
  await admin.api('POST', wsPath('/members'), {username: VIEWER_USER});
  await put(wsPath('/project-access'), {userId: viewer.me.id, projectId: p1, access: 'read'});
  await put(wsPath('/project-access'), {userId: viewer.me.id, projectId: p2, access: 'read'});
  // 对照成员：在项目里有读权限，但不在「指定成员可见」分组的名单里
  await admin.api('POST', wsPath('/members'), {username: OUTSIDER_USER});
  await put(wsPath('/project-access'), {userId: outsider.me.id, projectId: p1, access: 'read'});
  await put(wsPath('/project-access'), {userId: outsider.me.id, projectId: p2, access: 'read'});
  d1 = (await post('/api/demands', {reqId: p1, title: '登录改造'})).id;
  d2 = (await post('/api/demands', {reqId: p1, title: '对账重构'})).id;
  plan = (await post('/api/test-plans', {reqId: p1, name: '回归计划-' + stamp})).id;

  mA = (await post('/api/test-modules', {reqId: p1, name: '账号体系'})).id;
  mB = (await post('/api/test-modules', {reqId: p1, name: '登录', parentId: mA})).id;
  mC = (await post('/api/test-modules', {reqId: p1, name: '验证码', parentId: mB})).id;
  mD = (await post('/api/test-modules', {reqId: p1, name: '对账'})).id;
  mE = (await post('/api/test-modules', {reqId: p1, name: '空目录'})).id;

  const rows = [
    ['c1', '登录成功跳转首页', mB, 'P0', d1, 'passed', null, {precondition: '环境标记 ' + MARK}],
    ['c2', '密码错误提示', mB, 'P1', d1, 'failed', 'viewer', {}],
    ['c3', '验证码过期重发', mC, 'P0', d2, 'blocked', null,
      {steps: [{action: '步骤标记 ' + MARK, expected: '重新下发'}]}],
    ['c4', '账号注销校验', mA, 'P2', null, null, null, {}],
    ['c5', '对账差异明细', mD, 'P3', d2, 'passed', 'viewer', {testData: '数据标记 ' + MARK}],
    ['c6', '对账任务重跑', mD, null, null, 'skipped', null, {}],
    ['c7', '未归类失败用例', null, 'P1', d1, 'failed', null, {}],
    ['c8', '未归类待执行', null, 'P0', null, null, null, {}],
    ['c9', '登录记住我', mB, 'P2', d2, 'passed', null, {}],
    ['c10', '对账导出', mD, 'P1', d1, null, null, {}],
    ['c11', '验证码识别', mC, 'P3', null, 'failed', 'viewer', {}],
    ['c12', '未归类通过用例', null, null, d2, 'passed', null, {}],
  ];
  for (const [key, title, moduleId, priority, demandId, status, by, extra] of rows) {
    c[key] = await post('/api/test-cases', {reqId: p1, title, moduleId, priority, demandId, ...extra});
    if (status) {
      await post(`/api/test-cases/${c[key].id}/runs`,
        {status, note: '回归-' + key, executedByUserId: by === 'viewer' ? viewer.me.id : admin.me.id});
    }
  }
  c.x1 = await post('/api/test-cases', {reqId: p2, title: '跨项目用例', module: '风控规则'});

  setTeam = await post('/api/case-sets', {reqId: p1, name: '冒烟集', visibility: 'team', note: '发布必跑'});
  setPersonal = await post('/api/case-sets', {reqId: p1, name: '我的草稿集', visibility: 'personal'});
  await post(`/api/case-sets/${setTeam.id}/members`, {ids: ids(['c1', 'c2', 'c3'])});
  await post(`/api/case-sets/${setPersonal.id}/members`, {ids: ids(['c1', 'c5'])});
}

/* ---------- A 列表查询 ---------- */
async function groupList() {
  const all = await get('/api/test-cases', {reqId: p1});
  eq(all.total, 12, '项目内共 12 条用例');
  eq(all.items.length, 12, '默认页宽返回全部');
  eq(all.limit, 100, '默认 limit=100');
  check(all.moduleNodes.length === 5, '列表附带目录树', all.moduleNodes);
  eq(all.moduleIdCounts.__none, 3, '目录计数含未归类');
  eq(all.moduleIdCounts[mB], 3, '目录计数按节点');
  eq(all.statusCounts.__untested, 3, '未执行计数');
  eq(all.statusCounts.__all, 12, '全部计数');

  const wide = await get('/api/test-cases', {reqId: p1, limit: 5000});
  eq(wide.limit, 200, '页宽上限 200');
  const one = await get('/api/test-cases', {reqId: p1, limit: 0});
  eq([one.limit, one.items.length], [1, 1], 'limit=0 归一到 1');
  const page2 = await get('/api/test-cases', {reqId: p1, limit: 5, offset: 5});
  eq([page2.total, page2.items.length, page2.hasMore], [12, 5, true], '第二页仍有更多');
  const tail = await get('/api/test-cases', {reqId: p1, limit: 5, offset: 10});
  eq([tail.items.length, tail.hasMore], [2, false], '末页 hasMore=false');
  const beyond = await get('/api/test-cases', {reqId: p1, offset: 99});
  eq(beyond.items.length, 0, 'offset 超出总数返回空页');

  const noAsc = await get('/api/test-cases', {reqId: p1, sort: 'no', sortDir: 'asc'});
  const nos = noAsc.items.map(r => r.caseNo);
  eq(nos, [...nos].sort((a, b) => a - b), '按编号升序');
  const noDesc = await get('/api/test-cases', {reqId: p1, sort: 'no', sortDir: 'desc'});
  eq(noDesc.items.map(r => r.caseNo), [...nos].reverse(), '按编号降序');
  const priAsc = await get('/api/test-cases', {reqId: p1, sort: 'pri', sortDir: 'asc'});
  eq(priAsc.items.map(r => r.priority || 'none'),
    ['P0', 'P0', 'P0', 'P1', 'P1', 'P1', 'P2', 'P2', 'P3', 'P3', 'none', 'none'], '优先级升序空值排末尾');
  const stAsc = await get('/api/test-cases', {reqId: p1, sort: 'status', sortDir: 'asc'});
  eq(stAsc.items.map(r => r.latestStatus || 'untested'),
    ['failed', 'failed', 'failed', 'blocked', 'passed', 'passed', 'passed', 'passed', 'skipped',
      'untested', 'untested', 'untested'], '结果升序：失败优先、未执行末尾');
  const modAsc = await get('/api/test-cases', {reqId: p1, sort: 'module', sortDir: 'asc'});
  eq(modAsc.items.map(r => r.moduleId || 'none'),
    [mA, mB, mB, mB, mC, mC, mD, mD, mD, 'none', 'none', 'none'], '目录排序是 DFS：父节点自身用例在子目录之前');
  eq(modAsc.items[modAsc.items.length - 1].moduleId, null, '未归类排在目录之后');
  const evil = await get('/api/test-cases', {reqId: p1, sort: 'no; DROP TABLE test_case', sortDir: 'sideways'});
  eq(evil.items.map(r => r.id), all.items.map(r => r.id), '非法排序回落 created desc，不拼进 SQL');
  const executed = await get('/api/test-cases', {reqId: p1, sort: 'executed', sortDir: 'asc'});
  eq(executed.items.slice(0, 3).every(r => r.latestAt == null), true, '未执行在 executed 升序里排前（NULL 最小）');

  const narrow = await get('/api/test-cases', {reqId: p1, q: MARK});
  eq(narrow.total, 0, '默认窄搜索不命中前置/数据/步骤');
  const deep = await get('/api/test-cases', {reqId: p1, q: MARK, searchWide: true});
  eqKeys(deep.items, ['c1', 'c3', 'c5'], '宽搜索命中前置、步骤、测试数据');
  const byTitle = await get('/api/test-cases', {reqId: p1, q: '对账'});
  eqKeys(byTitle.items, ['c10', 'c5', 'c6'], '窄搜索命中标题与模块名');
  const byNo = await get('/api/test-cases', {reqId: p1, q: 'TC-' + String(c.c1.caseNo).padStart(3, '0')});
  eq(keyOf(byNo.items), ['c1'], '按用例编号搜索');
  const byNum = await get('/api/test-cases', {reqId: p1, q: String(c.c2.caseNo)});
  eq(keyOf(byNum.items), ['c2'], '纯数字按编号搜索');

  eqKeys((await get('/api/test-cases', {reqId: p1, moduleId: mB})).items, ['c1', 'c2', 'c9'],
    '目录筛选默认只含本节点');
  eqKeys((await get('/api/test-cases', {reqId: p1, moduleId: mA, moduleSub: true})).items,
    ['c1', 'c2', 'c3', 'c4', 'c9', 'c11'], '含子目录展开整棵子树');
  eq((await get('/api/test-cases', {reqId: p1, moduleId: mA})).total, 1, '父节点不含子目录时只 1 条');
  eqKeys((await get('/api/test-cases', {reqId: p1, moduleId: '__none'})).items,
    ['c12', 'c7', 'c8'], '未归类筛选');
  eq((await get('/api/test-cases', {reqId: p1, module: '登录'})).total, 3, '旧 module 文本口径仍可用');
  eqKeys((await get('/api/test-cases', {reqId: p1, demandId: d1})).items, ['c1', 'c10', 'c2', 'c7'],
    '按需求筛选');
  eq((await get('/api/test-cases', {reqId: p1, demandId: '__none'})).total, 4, '未关联需求筛选');
  eq((await get('/api/test-cases', {reqId: p1, status: '__untested'})).total, 3, '未执行筛选');
  eq((await get('/api/test-cases', {reqId: p1, pri: '__none'})).total, 2, '未设置优先级筛选');
  eq((await get('/api/test-cases', {reqId: p1, owner: viewer.me.displayName})).total, 3, '按最近执行人筛选');
  eq((await get('/api/test-cases', {reqId: p1, owner: '__none'})).total, 3, '未指派执行人筛选');
  eq((await get('/api/test-cases', {reqId: p1, setId: setTeam.id})).total, 3, '按团队分组筛选');
  eq((await get('/api/test-cases', {reqId: p1, setId: '__none'})).total, 8, '未加入任何可见分组');
  eq((await get('/api/test-cases', {reqId: p1, bugOnly: true})).total, 0, '无缺陷时 bugOnly 为空');
  const combo = await get('/api/test-cases',
    {reqId: p1, moduleId: mA, moduleSub: true, pri: 'P0', status: 'failed'});
  eq(combo.total, 0, '组合筛选：子树内 P0 无失败');
  const combo2 = await get('/api/test-cases', {reqId: p1, moduleId: mA, moduleSub: true, pri: 'P0'});
  eqKeys(combo2.items, ['c1', 'c3'], '组合筛选：子树内 P0');
  const excluded = await get('/api/test-cases', {reqId: p1, excludeIds: ids(['c1', 'c2'])});
  eq(excluded.total, 10, 'excludeIds 从列表里剔除');
  await admin.reject('GET', '/api/test-cases', undefined, 400, workspace.id,
    {reqId: p1, excludeIds: Array.from({length: 501}, () => 'X')});
  await admin.reject('GET', '/api/test-cases', undefined, 400, workspace.id, {reqId: '不存在的项目'});
}

/* ---------- B 分组计数 ---------- */
async function groupSegments() {
  const mods = await get('/api/test-cases/groups', {reqId: p1, groupBy: 'module'});
  eq(counts(mods), {[mA]: 1, [mB]: 3, [mC]: 2, [mD]: 3, [mE]: 0, __none: 3}, '目录分组计数（含空目录段）');
  eq(seg(mods, mC).label, '账号体系 / 登录 / 验证码', '目录段头是全路径');
  eq(seg(mods, mB).passed, 2, '段内结果分布：登录 2 通过');
  eq(seg(mods, mB).failed, 1, '段内结果分布：登录 1 失败');
  eq(seg(mods, mE).total, 0, '空目录保留零计数段');
  eq(mods.reduce((s, g) => s + g.total, 0), 12, '目录单归属：段计数可相加');

  const pris = await get('/api/test-cases/groups', {reqId: p1, groupBy: 'priority'});
  eq(counts(pris), {P0: 3, P1: 3, P2: 2, P3: 2, __none: 2}, '优先级分组计数');
  eq(pris.map(g => g.key), ['P0', 'P1', 'P2', 'P3', '__none'], '优先级段顺序固定');
  const sts = await get('/api/test-cases/groups', {reqId: p1, groupBy: 'status'});
  eq(counts(sts), {failed: 3, blocked: 1, passed: 4, skipped: 1, __untested: 3}, '执行结果分组计数');
  const owners = await get('/api/test-cases/groups', {reqId: p1, groupBy: 'owner'});
  eq(counts(owners), {[admin.me.displayName]: 6, [viewer.me.displayName]: 3, __none: 3},
    '执行人分组计数（口径是显示名，与列表 owners 一致）');
  const demands = await get('/api/test-cases/groups', {reqId: p1, groupBy: 'demand'});
  eq(counts(demands), {[d1]: 4, [d2]: 4, __none: 4}, '需求分组计数');
  check(seg(demands, d1).label.includes('登录改造'), '需求段头带标题', seg(demands, d1));

  const sets = await get('/api/test-cases/groups', {reqId: p1, groupBy: 'set'});
  eq(counts(sets), {[setTeam.id]: 3, [setPersonal.id]: 2}, '自定义分组计数（多归属可重叠）');
  eq(seg(sets, setTeam.id).passed, 1, '分组段内结果分布');
  const vsets = await vget('/api/test-cases/groups', {reqId: p1, groupBy: 'set'});
  eq(counts(vsets), {[setTeam.id]: 3}, '别人的个人分组不出现在段头');

  const scoped = await get('/api/test-cases/groups', {reqId: p1, groupBy: 'module', pri: 'P0'});
  eq(counts(scoped), {[mA]: 0, [mB]: 1, [mC]: 1, [mD]: 0, [mE]: 0, __none: 1}, '分组计数跟随当前筛选');
  const scopedSet = await get('/api/test-cases/groups',
    {reqId: p1, groupBy: 'set', moduleId: mA, moduleSub: true});
  eq(counts(scopedSet), {[setTeam.id]: 3, [setPersonal.id]: 1}, '分组段计数也受目录筛选约束');
  await admin.reject('GET', '/api/test-cases/groups', undefined, 400, workspace.id, {reqId: p1});
  await admin.reject('GET', '/api/test-cases/groups', undefined, 400, workspace.id,
    {reqId: p1, groupBy: 'evil'});
}

/* ---------- C 目录 CRUD ---------- */
async function groupDirectory() {
  const tree = await get('/api/test-modules', {reqId: p1});
  eq(tree.map(n => n.name), ['账号体系', '登录', '验证码', '对账', '空目录'], '目录树按 DFS 顺序');
  eq(tree.map(n => n.level), [1, 2, 3, 1, 1], '层级正确');
  eq(tree.find(n => n.id === mA).subtreeCount, 6, '父节点子树计数含后代');
  eq(tree.find(n => n.id === mA).caseCount, 1, '父节点自身计数不含后代');
  const lv4 = await post('/api/test-modules', {reqId: p1, name: '第四级', parentId: mC});
  eq(lv4.level, 4, '目录可建到第 4 级（不限层级，与文档分类同口径）');
  const lv5 = await post('/api/test-modules', {reqId: p1, name: '第五级', parentId: lv4.id});
  eq(lv5.level, 5, '目录可继续建到第 5 级');
  await admin.reject('POST', '/api/test-modules', {reqId: p1, name: '登录', parentId: mA}, 400);
  await admin.reject('POST', '/api/test-modules', {reqId: p1, name: '对账'}, 400);
  const foreignNode = await post('/api/test-modules', {reqId: p2, name: '风控目录'});
  await admin.reject('POST', '/api/test-modules', {reqId: p1, name: '借别项目目录', parentId: foreignNode.id}, 400);
  await admin.reject('POST', '/api/test-cases', {reqId: p1, title: '借别项目节点', moduleId: foreignNode.id}, 400);
  await del(`/api/test-modules/${foreignNode.id}`);
  await admin.reject('DELETE', `/api/test-modules/${mA}`, undefined, 400);
  await admin.reject('DELETE', `/api/test-modules/${mB}`, undefined, 400);
  const renamed = await put(`/api/test-modules/${mE}`, {reqId: p1, name: '待归类'});
  eq(renamed.name, '待归类', '目录可改名');
  const reparented = await put(`/api/test-modules/${mE}`, {reqId: p1, name: '待归类', parentId: mD});
  eq(reparented.level, 2, '目录可改上级');
  await admin.reject('PUT', `/api/test-modules/${mA}`, {reqId: p1, name: '账号体系', parentId: mC}, 400);
  await admin.reject('PUT', `/api/test-modules/${mA}`, {reqId: p1, name: '账号体系', parentId: mA}, 400);
  const freed = await post('/api/test-modules', {reqId: p1, name: '临时目录'});
  await del(`/api/test-modules/${freed.id}`);
  eq((await get('/api/test-modules', {reqId: p1})).some(n => n.id === freed.id), false, '空目录可删除');
  const auto = await post('/api/test-cases', {reqId: p1, title: '自由文本模块用例', module: '自由文本'});
  const autoTree = await get('/api/test-modules', {reqId: p1});
  const autoNode = autoTree.find(n => n.name === '自由文本');
  check(!!autoNode && autoNode.level === 1, '自由文本模块自动补建顶级目录', autoTree);
  eq(auto.moduleId, autoNode.id, '用例落到自动补建的节点');
  eq(auto.module, '自由文本', 'module 文本与节点名一致');
  await del(`/api/test-cases/${auto.id}`);
  await del(`/api/test-modules/${autoNode.id}`);
  /* 深层目录参与排序：同一目录的用例连续，且顺序与目录树 DFS 一致，未挂目录的排在最后 */
  const deepCase = await post('/api/test-cases', {reqId: p1, title: '深层目录用例', moduleId: lv5.id});
  const treeDeep = await get('/api/test-modules', {reqId: p1});
  const pos = {};
  treeDeep.forEach((n, i) => { pos[n.id] = i; });
  const sortedDeep = await get('/api/test-cases', {reqId: p1, sort: 'module', sortDir: 'asc', limit: 100});
  const runs = [];
  ((sortedDeep && sortedDeep.items) || []).forEach(c => {
    const key = c.moduleId || '__none';
    if(runs[runs.length - 1] !== key) runs.push(key);
  });
  eq(runs.length, new Set(runs).size, '按目录排序时同一目录的用例连续');
  const dfsIdx = runs.filter(k => k !== '__none').map(k => pos[k]);
  check(dfsIdx.every((v, i) => i === 0 || dfsIdx[i - 1] <= v), '目录排序顺序与目录树 DFS 一致（含第 5 级）', runs);
  check(runs.indexOf(lv5.id) >= 0 && runs.indexOf(mC) >= 0 && runs.indexOf(mC) < runs.indexOf(lv5.id),
    '第 5 级用例紧跟在所属第 3 级之后（DFS 顺序）', runs);
  await del(`/api/test-cases/${deepCase.id}`);
  await del(`/api/test-modules/${lv5.id}`);
  await del(`/api/test-modules/${lv4.id}`);
  eq((await get('/api/test-modules', {reqId: p1})).some(n => n.name === '第四级' || n.name === '第五级'), false,
    '深层目录可逐级删除');
  await viewer.reject('POST', '/api/test-modules', {reqId: p1, name: '查看者建目录'}, 403);
}

/* ---------- D 拖拽移动与撤销 ---------- */
async function groupMove() {
  const moved = await post('/api/test-cases/move-module',
    {selection: {ids: ids(['c7', 'c8'])}, moduleId: mD});
  eq([moved.moved, moved.skipped], [2, 0], '明确勾选移动 2 条');
  eq(moved.items.map(i => i.moduleId), [null, null], '返回原目录用于撤销');
  const after = await get('/api/test-cases', {reqId: p1, moduleId: mD});
  eq(after.total, 5, '目标目录计数增加');
  eq((await get('/api/test-cases', {reqId: p1, moduleId: '__none'})).total, 1, '未归类减少');
  const kept = await get('/api/test-cases', {reqId: p1, q: '未归类失败用例'});
  eq([kept.items[0].caseNo, kept.items[0].latestStatus], [c.c7.caseNo, 'failed'], '移动不改编号与执行历史');
  eq(kept.items[0].module, '对账', 'module 文本同步为节点名');

  const noop = await post('/api/test-cases/move-module', {selection: {ids: ids(['c7'])}, moduleId: mD});
  eq([noop.moved, noop.items.length], [0, 0], '已在目标目录时静默跳过');
  const restored = await post('/api/test-cases/restore-module', {items: moved.items});
  eq(restored.restored, 2, '撤销恢复原目录');
  eq((await get('/api/test-cases', {reqId: p1, moduleId: '__none'})).total, 3, '撤销后未归类回到 3 条');

  const byFilter = await post('/api/test-cases/move-module',
    {selection: {allFiltered: true, filter: {reqId: p1, pri: 'P3'}, excludeIds: ids(['c11'])}, moduleId: mE});
  eq(byFilter.moved, 1, '按筛选全选移动（含未加载行）并支持取消勾选');
  eq(keyOf((await get('/api/test-cases', {reqId: p1, moduleId: mE})).items), ['c5'], '命中的正是 c5');
  await post('/api/test-cases/restore-module', {items: byFilter.items});
  await admin.reject('POST', '/api/test-cases/move-module',
    {selection: {ids: ids(['c1'])}, moduleId: 'Mnotexist'}, 400);
  await admin.reject('POST', '/api/test-cases/move-module', {moduleId: mD}, 400);
  await admin.reject('POST', '/api/test-cases/move-module',
    {selection: {allFiltered: true}, moduleId: mD}, 400);
  await admin.reject('POST', '/api/test-cases/move-module',
    {selection: {ids: ids(['c1', 'x1'])}, moduleId: mD}, 400);
  await admin.reject('POST', '/api/test-cases/restore-module', {items: []}, 400);
  await viewer.reject('POST', '/api/test-cases/move-module',
    {selection: {ids: ids(['c1'])}, moduleId: mD}, 403);
  const partial = await post('/api/test-cases/move-module',
    {selection: {ids: [c.c12.id, 'Tnotexist']}, moduleId: mD});
  eq([partial.moved, partial.skipped], [1, 1], '不存在的 ID 跳过并回报差值');
  await post('/api/test-cases/restore-module', {items: partial.items});
  const toNone = await post('/api/test-cases/move-module',
    {selection: {ids: ids(['c12'])}, moduleId: null});
  eq(toNone.moved, 0, '移到「未归类」时本来未归类的用例不动');
  const toNone2 = await post('/api/test-cases/move-module',
    {selection: {ids: ids(['c6'])}, moduleId: null});
  eq([toNone2.moved, toNone2.items[0].moduleId], [1, mD], '可从目录移回未归类');
  await post('/api/test-cases/restore-module', {items: toNone2.items});
  eq((await get('/api/test-cases', {reqId: p1, moduleId: mD})).total, 3, '撤销后目录计数复原');
}

/* ---------- E 自定义分组 ---------- */
async function groupSets() {
  const list = await get('/api/case-sets', {reqId: p1});
  eq(list.map(s => s.name).sort(), ['我的草稿集', '冒烟集'].sort(), '分组列表');
  eq(list.find(s => s.id === setTeam.id).caseCount, 3, '团队分组计数');
  eq(list.find(s => s.id === setTeam.id).editable, true, '团队分组可编辑');
  const vlist = await vget('/api/case-sets', {reqId: p1});
  eq(vlist.map(s => s.name), ['冒烟集'], '查看者只看到团队分组');
  eq(vlist[0].editable, false, '查看者不可编辑');

  const dup = await post(`/api/case-sets/${setTeam.id}/members`, {ids: ids(['c1', 'c4'])});
  eq([dup.matched, dup.already, dup.added], [2, 1, 1], '重复加入静默跳过');
  const byFilter = await post(`/api/case-sets/${setTeam.id}/members`,
    {allFiltered: true, filter: {reqId: p1, status: 'failed'}, excludeIds: ids(['c2'])});
  eq([byFilter.matched, byFilter.added], [2, 2], '按筛选圈选入分组（失败 3 条去掉 c2）');
  eq((await get('/api/test-cases', {reqId: p1, setId: setTeam.id})).total, 6, '分组成员累计 6 条');
  const removed = await post(`/api/case-sets/${setTeam.id}/members/remove`, {ids: ids(['c7', 'c11'])});
  eq(removed.removed, 2, '移出分组');
  eq((await get('/api/test-cases', {reqId: p1})).total, 12, '移出分组不删用例本体');
  const renamed = await put(`/api/case-sets/${setTeam.id}`,
    {reqId: p1, name: '冒烟集', note: '改说明', visibility: 'team'});
  eq(renamed.note, '改说明', '分组可编辑说明');
  const toPersonal = await put(`/api/case-sets/${setTeam.id}`,
    {reqId: p1, name: '冒烟集', visibility: 'personal'});
  eq([toPersonal.visibility, toPersonal.ownerUserId], ['personal', admin.me.id],
    '创建人可把团队分组转为仅自己可见');
  const backToTeam = await put(`/api/case-sets/${setTeam.id}`,
    {reqId: p1, name: '冒烟集', visibility: 'team'});
  eq([backToTeam.visibility, backToTeam.ownerUserId], ['team', ''], '转回团队共享后不再归属个人');
  eq((await get('/api/test-cases', {reqId: p1, setId: setTeam.id})).total, 4, '转换可见范围不动成员');
  await admin.reject('POST', '/api/case-sets', {reqId: p1, name: '冒烟集', visibility: 'team'}, 400);
  await admin.reject('POST', '/api/case-sets', {reqId: p1, name: '非法可见性', visibility: 'public'}, 400);
  await admin.reject('POST', `/api/case-sets/${setTeam.id}/members`, {ids: [c.x1.id]}, 400);
  await admin.reject('POST', `/api/case-sets/${setTeam.id}/members`, {ids: []}, 400);
  await viewer.reject('POST', `/api/case-sets/${setTeam.id}/members`, {ids: ids(['c4'])}, 403);
  await viewer.reject('GET', '/api/test-cases', undefined, 404, workspace.id,
    {reqId: p1, setId: setPersonal.id});
  await viewer.reject('GET', '/api/test-cases/groups', undefined, 404, workspace.id,
    {reqId: p1, groupBy: 'module', setId: setPersonal.id});
  await viewer.reject('PUT', `/api/case-sets/${setPersonal.id}`,
    {reqId: p1, name: '偷改', visibility: 'personal'}, 404);
  eq(setPersonal.ownerUserId, admin.me.id, '个人分组归属创建人');
  eq(setTeam.ownerUserId, '', '团队分组不归属个人');
  const doomed = await post('/api/case-sets', {reqId: p1, name: '待删分组', visibility: 'team'});
  await post(`/api/case-sets/${doomed.id}/members`, {ids: ids(['c4', 'c6'])});
  await del(`/api/case-sets/${doomed.id}`);
  eq((await get('/api/test-cases', {reqId: p1})).total, 12, '删除分组保留用例');
  eq((await get('/api/test-cases', {reqId: p1, moduleId: mD})).total, 3, '删除分组不影响目录归类');
}

/* ---------- F 批量改与批量删 ---------- */
async function groupBatch() {
  const upd = await put('/api/test-cases/batch',
    {ids: ids(['c4', 'c8']), moduleAction: 'set', moduleId: mE, priorityAction: 'set', priority: 'P0'});
  eq(upd.updated, 2, '批量设置目录与优先级');
  const rows = await get('/api/test-cases', {reqId: p1, moduleId: mE});
  eq(rows.total, 2, '批量归到同一目录');
  eq(rows.items.every(r => r.priority === 'P0'), true, '批量优先级生效');
  const cleared = await put('/api/test-cases/batch',
    {allFiltered: true, filter: {reqId: p1, moduleId: mE}, moduleAction: 'clear', priorityAction: 'clear'});
  eq(cleared.updated, 2, '按筛选批量清空');
  eqKeys((await get('/api/test-cases', {reqId: p1, moduleId: '__none', limit: 200})).items,
    ['c4', 'c7', 'c8', 'c12'], '清空后回到未归类');
  eq((await get('/api/test-cases', {reqId: p1, pri: '__none'})).total, 4, '清空优先级后未设置 4 条');
  await put('/api/test-cases/batch',
    {ids: ids(['c4']), moduleAction: 'set', moduleId: mA, priorityAction: 'set', priority: 'P2'});
  await put('/api/test-cases/batch', {ids: ids(['c8']), priorityAction: 'set', priority: 'P0'});
  await admin.reject('PUT', '/api/test-cases/batch', {ids: ids(['c1']), moduleAction: 'set'}, 400);
  await admin.reject('PUT', '/api/test-cases/batch',
    {ids: ids(['c1']), priorityAction: 'set', priority: 'P9'}, 400);
  await admin.reject('PUT', '/api/test-cases/batch', {ids: ids(['c1']), moduleAction: 'evil'}, 400);
  await viewer.reject('PUT', '/api/test-cases/batch',
    {ids: ids(['c1']), priorityAction: 'set', priority: 'P0'}, 403);

  const tmp = [];
  for (const title of ['待删一', '待删二', '待删三']) {
    tmp.push((await post('/api/test-cases', {reqId: p1, title, moduleId: mE})).id);
  }
  await post(`/api/case-sets/${setTeam.id}/members`, {ids: tmp});
  const deleted = await post('/api/test-cases/batch-delete',
    {allFiltered: true, filter: {reqId: p1, moduleId: mE}, excludeIds: [tmp[2]]});
  eq([deleted.deleted, deleted.skipped], [2, 0], '按筛选批量删除并尊重取消勾选');
  eq((await get('/api/test-cases', {reqId: p1})).total, 13, '只剩取消勾选的那条');
  eq((await get('/api/test-cases', {reqId: p1, setId: setTeam.id})).total, 5, '删用例同时摘掉分组成员引用');
  await post('/api/test-cases/batch-delete', {ids: [tmp[2]]});
  eq((await get('/api/test-cases', {reqId: p1})).total, 12, '清理临时用例');
  await viewer.reject('POST', '/api/test-cases/batch-delete', {ids: ids(['c1'])}, 403);
}

/* ---------- G 导出 ---------- */
async function groupExport() {
  // 固定数据里每条用例最多 1 个步骤，CSV 字段内不会出现换行，行数即条数
  const csvLines = text => text.trim().split('\n').length - 1;
  const allCsv = await admin.request('GET', '/api/test-cases/export.csv', undefined, workspace.id, {reqId: p1});
  check(allCsv.status === 200 && allCsv.hasBom, '整项目导出带 BOM', allCsv.status);
  eq(csvLines(allCsv.text), 12, '整项目导出 12 行');
  const filtered = await admin.request('GET', '/api/test-cases/export.csv', undefined, workspace.id,
    {reqId: p1, scope: 'filter', moduleId: mA, moduleSub: true, sort: 'no', sortDir: 'asc'});
  eq(csvLines(filtered.text), 6, '按筛选导出命中子树 6 行');
  const picked = await admin.request('GET', '/api/test-cases/export.csv', undefined, workspace.id,
    {reqId: p1, scope: 'ids', ids: ids(['c1', 'c5'])});
  eq(csvLines(picked.text), 2, '按勾选导出 2 行');
  check(picked.headers['content-disposition'].includes('test-cases-selected.csv'), '勾选导出文件名区分',
    picked.headers['content-disposition']);
  const tooMany = await admin.request('GET', '/api/test-cases/export.csv', undefined, workspace.id,
    {reqId: p1, scope: 'ids', ids: Array.from({length: 201}, (_, i) => 'T' + i)});
  eq(tooMany.code, 400, '勾选导出上限 200');
  const none = await admin.request('GET', '/api/test-cases/export.csv', undefined, workspace.id,
    {reqId: p1, scope: 'filter', q: '一定不存在的关键词ZZZ'});
  eq(csvLines(none.text), 0, '筛选无命中时只导出表头');
  const byViewer = await viewer.request('GET', '/api/test-cases/export.csv', undefined, workspace.id, {reqId: p1});
  eq([byViewer.status, csvLines(byViewer.text)], [200, 12], '查看者可导出（只读动作）');
}

/* ---------- H 按筛选圈选入计划 ---------- */
async function groupPlan() {
  const dry = await post(`/api/test-plans/${plan}/cases/by-filter`,
    {filter: {reqId: p1, pri: 'P0'}, required: true, dryRun: true});
  eq([dry.matched, dry.already, dry.added, dry.dryRun], [3, 0, 3, true], '试算报出将新增条数且不落库');
  eq((await get(`/api/test-plans/${plan}/cases`)).total, 0, '试算后计划仍为空');
  const real = await post(`/api/test-plans/${plan}/cases/by-filter`,
    {filter: {reqId: p1, pri: 'P0'}, excludeIds: ids(['c8']), required: true});
  eq([real.matched, real.added, real.already], [2, 2, 0], '按筛选加入并支持取消勾选');
  const cases = await get(`/api/test-plans/${plan}/cases`);
  eq(cases.total, 2, '计划内 2 条');
  eq(cases.items.every(i => i.required === true), true, '标记为发布必测');
  const again = await post(`/api/test-plans/${plan}/cases/by-filter`, {filter: {reqId: p1, pri: 'P0'}});
  eq([again.matched, again.added, again.already], [3, 1, 2], '第二次不带排除：补进 c8，其余跳过');
  eq((await get(`/api/test-plans/${plan}/cases`)).total, 3, '计划内累计 3 条');
  const bySet = await post(`/api/test-plans/${plan}/cases/by-filter`,
    {filter: {reqId: p1, setId: setTeam.id}});
  eq(bySet.added, 2, '按分组圈选入计划（4 条里 2 条已在计划）');
  await admin.reject('POST', `/api/test-plans/${plan}/cases/by-filter`, {}, 400);
  // 计划强归属项目：筛选里写别的项目也会被强制改回计划所属项目，不会跨项目圈选
  const coerced = await post(`/api/test-plans/${plan}/cases/by-filter`, {filter: {reqId: p2, pri: 'P0'}});
  eq([coerced.matched, coerced.added], [3, 0], '筛选里的别项目 ID 被强制改回计划所属项目');
  await viewer.reject('POST', `/api/test-plans/${plan}/cases/by-filter`,
    {filter: {reqId: p1, pri: 'P1'}}, 403);
  const crossProject = await post('/api/test-plans', {reqId: p2, name: '风控计划-' + stamp});
  await admin.reject('POST', `/api/test-plans/${crossProject.id}/cases/by-filter`,
    {filter: {reqId: p1, pri: 'P0'}}, 400);
  const cross = await post(`/api/test-plans/${crossProject.id}/cases/by-filter`, {filter: {reqId: p1}});
  eq([cross.matched, cross.added], [1, 1], '别项目计划只圈到自己项目的用例，不会跨项目捞取');
}

/* ---------- I 权限与隔离 ---------- */
async function groupAccess() {
  const vlist = await vget('/api/test-cases', {reqId: p1, limit: 5});
  eq(vlist.total, 12, '查看者可读列表');
  await viewer.reject('POST', '/api/test-cases', {reqId: p1, title: '查看者建用例'}, 403);
  await viewer.reject('DELETE', `/api/test-cases/${c.c1.id}`, undefined, 403);
  await viewer.reject('POST', `/api/test-cases/${c.c1.id}/runs`, {status: 'passed'}, 403);
  await viewer.reject('POST', '/api/case-sets', {reqId: p1, name: 'x', visibility: 'team'}, 403);
  await viewer.reject('DELETE', `/api/case-sets/${setTeam.id}`, undefined, 403);
  await viewer.reject('DELETE', `/api/test-modules/${mE}`, undefined, 403);
  const spaces = await admin.api('GET', '/api/workspaces');
  const other = spaces.find(w => w.id !== workspace.id && w.id !== PROTECTED);
  check(!!other, '存在用于隔离对照的其它空间');
  const foreign = await admin.request('GET', '/api/test-cases', undefined, other.id, {reqId: p1});
  check(foreign.code !== 0, '别空间查不到本项目用例', foreign.code);
  const foreignSets = await admin.request('GET', '/api/case-sets', undefined, other.id, {reqId: p1});
  check(foreignSets.code !== 0 || foreignSets.data.length === 0, '别空间读不到本项目分组', foreignSets);
  const foreignTree = await admin.request('GET', '/api/test-modules', undefined, other.id, {reqId: p1});
  check(foreignTree.code !== 0 || foreignTree.data.length === 0, '别空间读不到本项目目录', foreignTree);
  const foreignProjects = await admin.api('GET', '/api/projects', undefined, other.id, {limit: 200});
  check(!foreignProjects.items.some(r => r.id === p1), '别空间项目列表不含临时项目');
}

/* ---------- J 动态分组：规则收录与自愈 ---------- */
let setRegression;
async function groupDynamic() {
  setRegression = await post('/api/case-sets',
    {reqId: p1, name: '回归集', visibility: 'team', kind: 'dynamic', rule: {regression: true}});
  eq([setRegression.kind, setRegression.caseCount], ['dynamic', 4], '动态回归集收录失败/阻塞 4 条');
  check(String(setRegression.ruleJson).includes('"regression":true'), '规则以白名单 JSON 落库', setRegression.ruleJson);
  eqKeys((await get('/api/test-cases', {reqId: p1, setId: setRegression.id, limit: 200})).items,
    ['c2', 'c3', 'c7', 'c11'], '动态分组成员与普通分组同口径可筛选');
  const seg0 = seg(await get('/api/test-cases/groups', {reqId: p1, groupBy: 'set'}), setRegression.id);
  eq([seg0.total, seg0.failed, seg0.blocked], [4, 3, 1], '分组段头计入动态成员');

  // 自愈：新失败用例自动进、删除自动出、最近一轮转通过自动移出
  const extra = await post('/api/test-cases', {reqId: p1, title: '动态新增失败用例', priority: 'P1'});
  await post(`/api/test-cases/${extra.id}/runs`, {status: 'failed', note: '自愈验证'});
  const countOf = async () => (await get('/api/case-sets', {reqId: p1})).find(s => s.id === setRegression.id).caseCount;
  eq(await countOf(), 5, '新失败用例被规则自动收录');
  eq((await get('/api/test-cases', {reqId: p1, setId: setRegression.id})).total, 5, '筛选口径同步自愈');
  await del(`/api/test-cases/${extra.id}`);
  eq(await countOf(), 4, '用例删除后动态分组自动摘除');
  await post(`/api/test-cases/${c.c10.id}/runs`, {status: 'failed', note: '自愈-失败'});
  eq(await countOf(), 5, '最近一轮转失败后自动收录');
  await post(`/api/test-cases/${c.c10.id}/runs`, {status: 'passed', note: '自愈-通过'});
  eq(await countOf(), 4, '最近一轮转通过后自动移出');

  const byStatus = await post('/api/case-sets',
    {reqId: p1, name: 'P0阻塞', kind: 'dynamic', rule: {status: 'blocked', pri: 'P0'}});
  eq(byStatus.caseCount, 1, '规则组合：阻塞 + P0 命中 1 条');
  const byModule = await post('/api/case-sets',
    {reqId: p1, name: '账号子树', kind: 'dynamic', rule: {moduleId: mA, moduleSub: true}});
  eq(byModule.caseCount, 6, '规则按目录子树收录 6 条');
  const byKeyword = await post('/api/case-sets',
    {reqId: p1, name: '标记关键词', kind: 'dynamic', rule: {q: MARK, searchWide: true}});
  eq(byKeyword.caseCount, 3, '规则关键词走大字段搜索命中 3 条');
  const byDemand = await post('/api/case-sets',
    {reqId: p1, name: '对账需求', kind: 'dynamic', rule: {demandId: d2}});
  eq(byDemand.caseCount, 4, '规则按需求收录 4 条');
  const byOwner = await post('/api/case-sets',
    {reqId: p1, name: '查看者执行', kind: 'dynamic', rule: {owner: viewer.me.displayName}});
  eq(byOwner.caseCount, 3, '规则按最近执行人（显示名口径）收录 3 条');
  const byBug = await post('/api/case-sets',
    {reqId: p1, name: '带缺陷', kind: 'dynamic', rule: {bugOnly: true}});
  eq(byBug.caseCount, 0, '无有效缺陷时规则命中 0 条，空分组合法');

  // 规则校验：缺规则 / 空规则 / 非法枚举 / 超长关键词 / 不存在的目录节点
  await admin.reject('POST', '/api/case-sets', {reqId: p1, name: '无规则', kind: 'dynamic'}, 400);
  await admin.reject('POST', '/api/case-sets', {reqId: p1, name: '空规则', kind: 'dynamic', rule: {}}, 400);
  await admin.reject('POST', '/api/case-sets',
    {reqId: p1, name: '非法结果', kind: 'dynamic', rule: {status: 'evil'}}, 400);
  await admin.reject('POST', '/api/case-sets',
    {reqId: p1, name: '非法优先级', kind: 'dynamic', rule: {pri: 'P9'}}, 400);
  await admin.reject('POST', '/api/case-sets',
    {reqId: p1, name: '超长关键词', kind: 'dynamic', rule: {q: 'x'.repeat(101)}}, 400);
  // 野目录与普通筛选同口径：目录校验先失败，返回 400
  await admin.reject('POST', '/api/case-sets',
    {reqId: p1, name: '野目录', kind: 'dynamic', rule: {moduleId: 'TMnotexists'}}, 400);
  await admin.reject('POST', '/api/case-sets',
    {reqId: p1, name: '非法类型', kind: 'evil', rule: {regression: true}}, 400);

  // 动态分组不接受手工增删；改成手工后保留已收录成员
  await admin.reject('POST', `/api/case-sets/${setRegression.id}/members`, {ids: ids(['c1'])}, 400);
  await admin.reject('POST', `/api/case-sets/${setRegression.id}/members/remove`, {ids: ids(['c2'])}, 400);
  const toManual = await put(`/api/case-sets/${setRegression.id}`,
    {reqId: p1, name: '回归集', visibility: 'team', kind: 'manual'});
  eq([toManual.kind, toManual.ruleJson, toManual.caseCount], ['manual', null, 4], '动态改手工保留已收录成员');
  eq((await post(`/api/case-sets/${setRegression.id}/members`, {ids: ids(['c1'])})).added, 1, '改手工后可手工增删');
  const backToDynamic = await put(`/api/case-sets/${setRegression.id}`,
    {reqId: p1, name: '回归集', visibility: 'team', kind: 'dynamic', rule: {regression: true}});
  eq(backToDynamic.caseCount, 4, '手工改动态按规则重算，手工加的成员被移出');

  // 目录删除守卫：规则引用的空目录不能删，删掉分组后才放行
  const guardSet = await post('/api/case-sets',
    {reqId: p1, name: '空目录规则', kind: 'dynamic', rule: {moduleId: mE}});
  eq(guardSet.caseCount, 0, '空目录规则命中 0 条');
  await admin.reject('DELETE', `/api/test-modules/${mE}`, undefined, 400);
  await del(`/api/case-sets/${guardSet.id}`);
  await del(`/api/test-modules/${mE}`);
  check(!(await get('/api/test-modules', {reqId: p1})).some(n => n.id === mE), '解除规则引用后目录可删');

  // 查看者：团队动态分组可见可筛选，但不可改
  const vlist = await vget('/api/case-sets', {reqId: p1});
  const vReg = vlist.find(s => s.id === setRegression.id);
  eq([vReg.kind, vReg.caseCount, vReg.editable], ['dynamic', 4, false], '查看者看到团队动态分组但不可编辑');
  eq((await vget('/api/test-cases', {reqId: p1, setId: setRegression.id})).total, 4, '查看者可按动态分组筛选');
  await viewer.reject('PUT', `/api/case-sets/${setRegression.id}`,
    {reqId: p1, name: '偷改', visibility: 'team', kind: 'dynamic', rule: {regression: true}}, 403);
  await viewer.reject('DELETE', `/api/case-sets/${setRegression.id}`, undefined, 403);

  for (const s of [byStatus, byModule, byKeyword, byDemand, byOwner, byBug]) {
    await del(`/api/case-sets/${s.id}`);
  }
  eq((await get('/api/case-sets', {reqId: p1})).map(s => s.name).sort(),
    ['我的草稿集', '冒烟集', '回归集'].sort(), '清理临时动态分组');
}

/* ---------- K 指定成员可见 + 团队分组进证据 ---------- */
async function groupMembersAndEvidence() {
  const setMembers = await post('/api/case-sets',
    {reqId: p1, name: '指定成员集', visibility: 'members', memberIds: [viewer.me.id]});
  await post(`/api/case-sets/${setMembers.id}/members`, {ids: ids(['c1', 'c5'])});
  eq([setMembers.visibility, setMembers.ownerUserId, setMembers.memberIds],
    ['members', admin.me.id, [viewer.me.id]], '指定成员可见：归属创建人 + 名单');
  const vlist = await vget('/api/case-sets', {reqId: p1});
  eq(vlist.map(s => s.name).sort(), ['冒烟集', '回归集', '指定成员集'].sort(), '名单内成员看得到该分组');
  eq(vlist.find(s => s.id === setMembers.id).editable, false, '名单内成员不可编辑（只有创建人能改）');
  eq((await vget('/api/test-cases', {reqId: p1, setId: setMembers.id})).total, 2, '名单内成员可按该分组筛选');
  const olist = await oget('/api/case-sets', {reqId: p1});
  check(!olist.some(s => s.id === setMembers.id), '名单外成员看不到该分组', olist.map(s => s.name));
  await outsider.reject('GET', '/api/test-cases', undefined, 404, workspace.id,
    {reqId: p1, setId: setMembers.id});
  await outsider.reject('PUT', `/api/case-sets/${setMembers.id}`,
    {reqId: p1, name: '偷改', visibility: 'members', memberIds: [outsider.me.id]}, 404);
  await viewer.reject('PUT', `/api/case-sets/${setMembers.id}`,
    {reqId: p1, name: '偷改', visibility: 'members', memberIds: [viewer.me.id]}, 403);
  // 名单校验：空名单 / 超上限 / 看不到本项目的人
  await admin.reject('POST', '/api/case-sets',
    {reqId: p1, name: '空名单', visibility: 'members', memberIds: []}, 400);
  await admin.reject('POST', '/api/case-sets',
    {reqId: p1, name: '超上限', visibility: 'members', memberIds: Array.from({length: 51}, (_, i) => 'U' + i)}, 400);
  await admin.reject('POST', '/api/case-sets',
    {reqId: p1, name: '无权限成员', visibility: 'members', memberIds: ['U-not-member']}, 400);
  // 名单可改：移出查看者后其立刻看不到，换进来的人立刻看得到
  const narrowed = await put(`/api/case-sets/${setMembers.id}`,
    {reqId: p1, name: '指定成员集', visibility: 'members', memberIds: [outsider.me.id]});
  eq(narrowed.memberIds, [outsider.me.id], '编辑分组即替换可见名单');
  check(!(await vget('/api/case-sets', {reqId: p1})).some(s => s.id === setMembers.id), '移出名单后立刻不可见');
  await viewer.reject('GET', '/api/test-cases', undefined, 404, workspace.id,
    {reqId: p1, setId: setMembers.id});
  eq((await oget('/api/test-cases', {reqId: p1, setId: setMembers.id})).total, 2, '换进名单后立刻可按该分组筛选');
  // 名单内成员即使拿到写权限也不是创建人：改不了指定成员分组；团队分组收窄同样要创建人
  await put(wsPath('/project-access'), {userId: outsider.me.id, projectId: p1, access: 'write'});
  await outsider.reject('PUT', `/api/case-sets/${setMembers.id}`,
    {reqId: p1, name: '偷改', visibility: 'members', memberIds: [outsider.me.id]}, 400);
  await outsider.reject('PUT', `/api/case-sets/${setTeam.id}`,
    {reqId: p1, name: '冒烟集', visibility: 'members', memberIds: [outsider.me.id]}, 400);
  await put(wsPath('/project-access'), {userId: outsider.me.id, projectId: p1, access: 'read'});

  // 证据：只有团队分组进发布检查与交付说明，个人 / 指定成员分组不进
  const version = await post('/api/versions', {reqId: p1, name: '证据版本-' + stamp, status: 'active'});
  const check0 = await get(`/api/versions/${version.id}/release-check`);
  const evTeam = check0.caseSets.find(s => s.id === setTeam.id);
  eq([evTeam.total, evTeam.passed, evTeam.failed, evTeam.blocked, evTeam.skipped, evTeam.untested],
    [4, 1, 1, 1, 0, 1], '发布检查带团队分组结果分布');
  const evReg = check0.caseSets.find(s => s.id === setRegression.id);
  eq([evReg.kind, evReg.total, evReg.failed, evReg.blocked], ['dynamic', 4, 3, 1], '动态团队分组同样进证据');
  check(!check0.caseSets.some(s => s.id === setPersonal.id || s.id === setMembers.id),
    '个人与指定成员分组不进发布证据', check0.caseSets.map(s => s.name));
  const note0 = await get(`/api/versions/${version.id}/delivery-note`);
  eq(note0.quality.caseSets.find(s => s.id === setTeam.id).total, 4, '交付说明质量段带同一口径分组证据');
  const evRow = note0.evidence.find(r => r.name === '用例分组');
  check(!!evRow && evRow.meta.includes('团队共享分组') && evRow.meta.includes('动态'),
    '证据清单出现用例分组行', evRow);
  // 冻结：内部版快照留存当时数字，之后改执行结果不回写快照
  await put(`/api/versions/${version.id}/delivery-note`, {options: {tone: 'internal'}, revision: 0});
  const snap = await post(`/api/versions/${version.id}/delivery-note/snapshots`, {});
  const frozen0 = await get(`/api/delivery-notes/${snap.snapshotId || snap.id}`);
  eq(frozen0.quality.caseSets.find(s => s.id === setTeam.id).passed, 1, '快照冻结分组证据');
  await post(`/api/test-cases/${c.c4.id}/runs`, {status: 'passed', note: '冻结后改结果'});
  const frozen1 = await get(`/api/delivery-notes/${snap.snapshotId || snap.id}`);
  eq(frozen1.quality.caseSets.find(s => s.id === setTeam.id).passed, 1, '快照不随后续执行结果变化');
  const check1 = await get(`/api/versions/${version.id}/release-check`);
  eq(check1.caseSets.find(s => s.id === setTeam.id).passed, 2, '实时发布检查按最新结果重算');
  // 删除分组只摘引用：用例与已冻结证据都保留
  await del(`/api/case-sets/${setMembers.id}`);
  eq((await get('/api/test-cases', {reqId: p1})).total, 12, '删除指定成员分组保留用例');
  const frozen2 = await get(`/api/delivery-notes/${snap.snapshotId || snap.id}`);
  eq(frozen2.quality.caseSets.find(s => s.id === setTeam.id).total, 4, '删除其它分组不影响已冻结证据');
}

let clean = false;
let kept = null;
try {
  await admin.login(ADMIN_PASS);
  await viewer.login(VIEWER_PASS);
  await outsider.login(OUTSIDER_PASS);
  await fixture();
  console.log('FIXTURE_OK', JSON.stringify({p1, p2, cases: Object.keys(c).length}));
  await group('A 列表：分页/排序白名单/搜索范围/组合筛选', groupList);
  await group('B 分组段头计数与筛选联动', groupSegments);
  await group('C 目录树 CRUD 与层级上限', groupDirectory);
  await group('D 拖拽移动与撤销', groupMove);
  await group('E 自定义分组：多归属/可见性/删除保留用例', groupSets);
  await group('F 批量改与批量删（按筛选 + 取消勾选）', groupBatch);
  await group('G 导出：整项目/按筛选/按勾选', groupExport);
  await group('H 按筛选圈选入计划', groupPlan);
  await group('I 权限与空间隔离', groupAccess);
  await group('J 动态分组：规则收录与自愈', groupDynamic);
  await group('K 指定成员可见 + 团队分组进证据', groupMembersAndEvidence);
} catch (error) {
  errors.push({group: 'setup', message: error.message, stack: error.stack});
  console.error('SETUP_FAIL', error.message);
} finally {
  if (workspace) {
    try {
      await admin.api('DELETE', wsPath(''), undefined, workspace.id);
      clean = true;
    } catch (error) {
      /* K 组要建版本与交付说明快照，产品规则禁止清空有交付历史的空间（version_create 即写审计）。
         这不是脚本缺陷：临时空间按 ID 留档，跑完用下面的 SQL 摘掉历史行后再走正常删除。 */
      if (String(error.message).includes('交付计划或发布历史')) {
        kept = workspace.id;
        console.log('TEMP_WORKSPACE_KEPT', workspace.id, '（含版本/交付说明历史，产品禁止清空）');
      } else {
        console.error('CLEANUP_FAIL', workspace.id, error.message);
      }
    }
  }
}
const failed = groups.filter(g => g.status === 'fail');
console.log(JSON.stringify({
  workspace: workspace && workspace.id, cleaned: clean, kept, assertions, apiChecks,
  writes: writes.length, groups, errors,
}, null, 2));
if (errors.length || (!clean && !kept)) process.exit(1);
console.log(`CASE_QUERY_API_OK ${assertions} 断言 / ${groups.length} 组 / 失败 ${failed.length}`);