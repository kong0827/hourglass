/* Real local API regression. Node 22+, no dependencies, credentials or demo writes.
 * Run: E2E_PASS=<password> E2E_MEMBER_PASS=<password> node tools/e2e/member-labels-api.mjs
 * Creates one private test workspace, never selects it, deletes it in finally.
 * X-Workspace-Id is supplied, AND workspace query is mandatory: current backend
 * WorkspaceArgumentResolver resolves the query, not this header.
 */
import assert from 'node:assert/strict';

const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8081/hourglass').replace(/\/+$/, '');
const baseUrl = new URL(BASE);
assert.equal(baseUrl.hostname, '127.0.0.1', 'Local loopback only');
assert.equal(baseUrl.port, '8081', 'Existing local frontend proxy only');
assert.equal(baseUrl.pathname, '/hourglass');
const PASS = process.env.E2E_PASS;
if (!PASS) throw new Error('E2E_PASS environment variable required');
const MEMBER_PASS = process.env.E2E_MEMBER_PASS || PASS;
const PROTECTED = 'Smw9zcftmwwnrwuon';
const stamp = Date.now().toString(36);
const workspaceName = 'API职能验证-' + stamp;
let workspace = null, assertions = 0, businessAssertions = 0, apiChecks = 0;
const errors = [], groups = [], tasks = new Set(), projects = new Set(), writes = [];
let activeGroup = 'preflight';
function check(condition, message, actual, api = false) {
  assertions++;
  if (api) apiChecks++; else businessAssertions++;
  assert.ok(condition, `${activeGroup}: ${message}${actual === undefined ? '' : ' | ' + JSON.stringify(actual)}`);
}
function eq(actual, expected, message) {
  assertions++; businessAssertions++;
  assert.deepEqual(actual, expected, `${activeGroup}: ${message}`);
}
function guard(method, url, payload) {
  if (method === 'GET') return;
  if (url.pathname.endsWith('/api/auth/login')) return;
  if (method === 'POST' && url.pathname.endsWith('/api/workspaces')) {
    assert.equal(payload.name, workspaceName);
    assert.equal(workspace, null, 'Only one newly created workspace permitted');
    return;
  }
  assert.ok(workspace && workspace.id !== PROTECTED, 'Must have an owned temporary workspace');
  assert.ok(!url.pathname.includes(PROTECTED) && url.searchParams.get('workspace') !== PROTECTED);
  const prefix = baseUrl.pathname + '/api/workspaces/' + workspace.id;
  assert.ok(url.pathname === prefix || url.pathname.startsWith(prefix + '/')
    || (url.searchParams.get('workspace') === workspace.id
      && /^\/hourglass\/api\/(?:projects|tasks)(?:\/|$)/.test(url.pathname)), 'Write outside temporary workspace blocked: ' + url.pathname);
  assert.ok(!url.pathname.endsWith('/select'), 'Never change lastWorkspaceId');
  writes.push({method, path: url.pathname, workspaceId: workspace.id});
}
class Session {
  constructor(username) { this.username = username; this.cookies = new Map(); this.before = null; }
  async request(method, endpoint, payload, ws = null, params = {}) {
    const url = new URL(BASE + endpoint);
    if (ws) url.searchParams.set('workspace', ws);
    for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
    guard(method, url, payload);
    const headers = {Cookie: [...this.cookies].map(([k,v]) => `${k}=${v}`).join('; ')};
    if (ws) headers['X-Workspace-Id'] = ws;
    let body;
    if (payload !== undefined) {
      const login = endpoint === '/api/auth/login';
      headers['Content-Type'] = login ? 'application/x-www-form-urlencoded' : 'application/json';
      body = login ? new URLSearchParams(payload).toString() : JSON.stringify(payload);
    }
    if (method !== 'GET') headers['X-XSRF-TOKEN'] = decodeURIComponent(this.cookies.get('XSRF-TOKEN') || '');
    const res = await fetch(url, {method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(20000)});
    for (const cookie of res.headers.getSetCookie()) {
      const [kv] = cookie.split(';'), i = kv.indexOf('=');
      this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await res.text();
    let envelope;
    try { envelope = JSON.parse(text); } catch { envelope = {code: -1, message: text.slice(0, 300)}; }
    // Track successful creates even if a rejection test unexpectedly succeeds.
    if (envelope.code === 0 && envelope.data?.id) {
      if (method === 'POST' && endpoint === '/api/workspaces') workspace = envelope.data;
      if (method === 'POST' && endpoint === '/api/tasks') tasks.add(envelope.data.id);
      if (method === 'POST' && endpoint === '/api/projects') projects.add(envelope.data.id);
    }
    return {status: res.status, ...envelope};
  }
  async api(method, endpoint, payload, ws = null, params = {}) {
    const r = await this.request(method, endpoint, payload, ws, params);
    check(r.status === 200 && r.code === 0, `${method} ${endpoint} succeeds`, r, true);
    return r.data;
  }
  async reject(method, endpoint, payload, code, ws = workspace.id, params = {}) {
    const r = await this.request(method, endpoint, payload, ws, params);
    check(r.code === code && [200, code].includes(r.status), `${method} ${endpoint} rejects ${code}`, r, true);
    return r;
  }
  async login(password) {
    await this.request('GET', '/login.html');
    // The static login page is served by frontend and does not issue a backend cookie.
    if (!this.cookies.has('XSRF-TOKEN')) await this.api('GET', '/api/health');
    check(this.cookies.has('XSRF-TOKEN'), 'CSRF cookie obtained before formLogin');
    await this.api('POST', '/api/auth/login', {username: this.username, password});
    this.before = await this.api('GET', '/api/auth/me');
    eq(this.before.username, this.username, 'Authenticated expected existing account');
  }
}
const admin = new Session('admin'), member = new Session('chenhao');
const get = (endpoint, params = {}) => admin.api('GET', endpoint, undefined, workspace.id, params);
const put = (endpoint, body) => admin.api('PUT', endpoint, body, workspace.id);
const post = (endpoint, body) => admin.api('POST', endpoint, body, workspace.id);
const wsPath = suffix => `/api/workspaces/${workspace.id}${suffix}`;
const rolePath = (pid, uid) => wsPath(`/projects/${pid}/member-roles${uid ? '/' + uid : ''}`);
const roster = pid => get(wsPath(`/projects/${pid}/members`));
const row = async (pid, uid) => (await roster(pid)).members.find(m => m.userId === uid);
const grant = (uid, pid, access) => put(wsPath('/project-access'), {userId: uid, projectId: pid, access});
const setJob = (uid, jobTitle) => put(wsPath(`/members/${uid}/job-title`), {jobTitle});
const setRole = (uid, role) => put(wsPath(`/members/${uid}/role`), {role});
const setCompany = (uid, companyName) => put(wsPath(`/members/${uid}/company`), {companyName});
async function group(name, run) {
  activeGroup = name;
  const before = assertions;
  try { await run(); groups.push({name, status: 'pass', assertions: assertions - before}); console.log(`PASS ${name}: ${assertions - before} assertions`); }
  catch (error) {
    const evidence = {group: name, message: error.message, actual: error.actual, expected: error.expected, stack: error.stack};
    errors.push(evidence); groups.push({name, status: 'fail', assertions: assertions - before});
    console.error('FAIL', JSON.stringify(evidence));
  }
}
let u1, u2, u3, outsider, p1, p2, p3, foreignWorkspace, foreignOptions;
let clean = false;
try {
  await admin.login(PASS);
  const allUsers = await admin.api('GET', '/api/admin/users', undefined, null, {limit: 100});
  check(Array.isArray(allUsers.items), 'User page envelope verified');
  const byName = name => allUsers.items.find(u => u.username === name);
  [u1, u2, u3, outsider] = ['chenhao','wangfang','zhaolei','lina'].map(byName);
  check([u1,u2,u3,outsider].every(u => u && !u.disabled && u.role === 'user'), 'Existing enabled demo accounts verified');
  const spaces = await admin.api('GET', '/api/workspaces');
  foreignWorkspace = spaces.find(w => w.type === 'shared' && w.id !== PROTECTED);
  check(!!foreignWorkspace, 'Read-only isolation reference workspace available');
  foreignOptions = await admin.api('GET', `/api/workspaces/${foreignWorkspace.id}/member-label-options`, undefined, foreignWorkspace.id);
  check(Array.isArray(foreignOptions.roleTitles) && Array.isArray(foreignOptions.companyNames), 'Dictionary arrays verified via GET');
  const existingProjects = await admin.api('GET', '/api/projects', undefined, foreignWorkspace.id, {limit: 1});
  const existingRoster = await admin.api('GET', `/api/workspaces/${foreignWorkspace.id}/projects/${existingProjects.items[0].id}/members`, undefined, foreignWorkspace.id);
  check(Array.isArray(existingRoster.members) && typeof existingRoster.canEditRole === 'boolean', 'Roster envelope verified before writes');
  check(existingRoster.members.every(m => ['userId','jobTitle','roleTitle','effectiveRoleTitle','roleSource','secondaryRoleTitles','access'].every(k => k in m)), 'Roster field contract verified before writes');
  const existingTasks = await admin.api('GET', '/api/tasks/list', undefined, foreignWorkspace.id, {limit: 1});
  check(Array.isArray(existingTasks.items) && typeof existingTasks.total === 'number', 'Task envelope verified before writes');
  const existingReports = await admin.api('GET', '/api/manager/reports', undefined, foreignWorkspace.id);
  check(!!existingReports.scope && typeof existingReports.burndown.totalEstimateMinutes === 'number', 'Report scope and aggregate fields verified before writes');
  console.log('READONLY_PREFLIGHT_OK; protected demonstration workspace never requested; backend requires workspace query in addition to header');

  await admin.api('POST', '/api/workspaces', {name: workspaceName});
  check(workspace.id !== PROTECTED && workspace.name === workspaceName, 'Unique temporary workspace created');
  console.log('TEMP_WORKSPACE', JSON.stringify({id: workspace.id, name: workspace.name}));
  for (const u of [u1,u2,u3]) await post(wsPath('/members'), {username: u.username});
  await setRole(u2.id, 'viewer');
  const members = await get(wsPath('/members'));
  eq(members.map(m => m.userId).sort(), [admin.before.id,u1.id,u2.id,u3.id].sort(), 'Only intended accounts added in new space');
  for (const label of ['source','target','restricted']) {
    const project = await post('/api/projects', {name: `API-${stamp}-${label}`, template: 'blank'});
    if (label === 'source') p1 = project.id;
    if (label === 'target') p2 = project.id;
    if (label === 'restricted') p3 = project.id;
  }
  // WorkspaceService.addMember creates MODE_ASSIGNED members, defaulting to none.
  // Verify that default via GET, then explicitly grant only our fixture projects.
  eq((await roster(p1)).members.map(m=>m.userId),[admin.before.id],'New assigned members initially cannot see fixture project');
  for (const uid of [u1.id,u3.id]) for (const pid of [p1,p2,p3]) await grant(uid,pid,'write');
  check((await roster(p1)).members.some(m=>m.userId===u1.id),'Explicit fixture project grant visible in roster');
  await member.login(MEMBER_PASS);

  await group('jobTitle inheritance, override, clearing and secondary roles', async () => {
    await setJob(u1.id, '后端开发');
    let r = await row(p1,u1.id);
    eq([r.jobTitle,r.effectiveRoleTitle,r.roleSource,r.secondaryRoleTitles], ['后端开发','后端开发','workspace',[]], 'Default jobTitle inherited');
    await put(rolePath(p1,u1.id), {roleTitle:'全栈工程师', secondaryRoleTitles:['测试','测试','全栈工程师','实施顾问']});
    r = await row(p1,u1.id);
    eq([r.effectiveRoleTitle,r.roleSource,r.secondaryRoleTitles], ['全栈工程师','project',['测试','实施顾问']], 'Override wins and secondary roles deduplicate/exclude primary');
    await setJob(u1.id, '前端开发');
    eq((await row(p1,u1.id)).effectiveRoleTitle, '全栈工程师', 'Changing default does not replace project override');
    eq((await row(p2,u1.id)).effectiveRoleTitle, '前端开发', 'Unmodified project immediately inherits new default');
    await put(rolePath(p1,u1.id), {roleTitle:'产品经理'});
    eq((await row(p1,u1.id)).secondaryRoleTitles, ['测试','实施顾问'], 'Omitted secondary roles preserved on single save');
    await put(rolePath(p1,u1.id), {roleTitle:''});
    r = await row(p1,u1.id);
    eq([r.effectiveRoleTitle,r.roleSource,r.secondaryRoleTitles], ['前端开发','workspace',['测试','实施顾问']], 'Clearing primary restores inheritance and retains secondary roles');
    await put(rolePath(p1,u1.id), {roleTitle:'',secondaryRoleTitles:[]});
    eq((await row(p1,u1.id)).secondaryRoleTitles, [], 'Explicit [] clears secondary roles');
    await setJob(u1.id, '');
    r = await row(p1,u1.id);
    eq([r.jobTitle,r.effectiveRoleTitle,r.roleSource], [null,null,'unset'], 'Cleared default and empty override yield unset');
    await setJob(u1.id, '后端开发');
  });

  await group('batch atomic rollback, omitted and explicit secondary roles', async () => {
    await put(rolePath(p1,u1.id), {roleTitle:'角色甲',secondaryRoleTitles:['兼岗甲']});
    await put(rolePath(p1,u3.id), {roleTitle:'角色乙',secondaryRoleTitles:['兼岗乙']});
    eq(await put(rolePath(p1), {userIds:[u1.id,u3.id,u1.id],roleTitle:'批量主职能'}), {updated:2}, 'Batch deduplicates member IDs');
    eq((await row(p1,u1.id)).secondaryRoleTitles, ['兼岗甲'], 'Batch omission preserves first member secondary');
    eq((await row(p1,u3.id)).secondaryRoleTitles, ['兼岗乙'], 'Batch omission preserves second member secondary');
    const before = await roster(p1);
    const beforeActivity = await get('/api/activity', {limit:200});
    const beforeAudit = await get('/api/admin/audit/logs', {size:100});
    for (const [invalid, code] of [[outsider.id,404],[u2.id,400]]) {
      await admin.reject('PUT', rolePath(p1), {userIds:[u1.id,invalid],roleTitle:'不得写入',secondaryRoleTitles:[]}, code);
      eq(await roster(p1), before, 'Invalid batch leaves all member role rows unchanged');
      eq((await get('/api/activity',{limit:200})).total, beforeActivity.total, 'Invalid batch produces no committed activity');
      eq((await get('/api/admin/audit/logs',{size:100})).total, beforeAudit.total, 'Invalid batch produces no committed audit');
    }
    await grant(u3.id,p1,'none');
    await admin.reject('PUT',rolePath(p1),{userIds:[u1.id,u3.id],roleTitle:'不得写入'},400);
    eq((await row(p1,u1.id)).roleTitle,'批量主职能','Invisible batch target cannot partially write valid first target');
    await grant(u3.id,p1,'write');
    eq((await row(p1,u3.id)).roleTitle,'批量主职能','Invisible target old role preserved after regrant');
    eq(await put(rolePath(p1), {userIds:[u1.id,u3.id],roleTitle:'批量主职能',secondaryRoleTitles:[]}), {updated:2}, 'Valid batch updates two');
    eq((await row(p1,u1.id)).secondaryRoleTitles, [], 'Batch [] clears first member secondary');
    eq((await row(p1,u3.id)).secondaryRoleTitles, [], 'Batch [] clears second member secondary');
  });

  await group('copy default skip and overwrite, effective inherited snapshot', async () => {
    await setJob(u1.id,'后端开发');
    await setJob(u3.id,'实施顾问');
    await put(rolePath(p1,u1.id),{roleTitle:'来源主职能',secondaryRoleTitles:['来源兼岗']});
    await put(rolePath(p1,u3.id),{roleTitle:'',secondaryRoleTitles:[]});
    await put(rolePath(p2,u1.id),{roleTitle:'目标既有职能',secondaryRoleTitles:['目标兼岗']});
    eq(await post(rolePath(p2)+'/copy',{sourceProjectId:p1}),{copied:1,skipped:1},'Omitted overwrite defaults to skipping existing target');
    eq([(await row(p2,u1.id)).roleTitle,(await row(p2,u1.id)).secondaryRoleTitles],['目标既有职能',['目标兼岗']],'Default copy preserves existing primary and secondary');
    let r = await row(p2,u3.id);
    eq([r.roleTitle,r.effectiveRoleTitle,r.roleSource],['实施顾问','实施顾问','project'],'Copy snapshots source inherited default');
    eq(await post(rolePath(p2)+'/copy',{sourceProjectId:p1,overwrite:true}),{copied:2,skipped:0},'Overwrite replaces both eligible member labels');
    r = await row(p2,u1.id);
    eq([r.roleTitle,r.secondaryRoleTitles],['来源主职能',['来源兼岗']],'Overwrite copies primary and secondary');
    await grant(u3.id,p2,'none');
    eq(await post(rolePath(p2)+'/copy',{sourceProjectId:p1,overwrite:true}),{copied:1,skipped:0},'Copy excludes invisible targets and viewers');
    await grant(u3.id,p2,'write');
  });

  await group('workspace-isolated candidates and foreign project rejection', async () => {
    const customRole = '隔离职能-'+stamp, customCompany = '隔离公司-'+stamp;
    await put(wsPath('/member-label-options'),{roleTitles:[customRole],companyNames:[customCompany]});
    const local = await get(wsPath('/member-label-options'));
    check(local.roleTitles.includes(customRole) && local.companyNames.includes(customCompany),'New dictionary labels appear locally');
    const foreign = await admin.api('GET',`/api/workspaces/${foreignWorkspace.id}/member-label-options`,undefined,foreignWorkspace.id);
    check(!foreign.roleTitles.includes(customRole) && !foreign.companyNames.includes(customCompany),'Temporary dictionary labels do not leak to reference workspace');
    await setJob(u1.id,'空间独有默认-'+stamp);
    await put(rolePath(p1,u1.id),{roleTitle:'项目独有主职能-'+stamp,secondaryRoleTitles:['项目独有兼岗-'+stamp]});
    const candidates = await get(wsPath('/member-label-options'));
    for (const label of ['空间独有默认-'+stamp,'项目独有主职能-'+stamp,'项目独有兼岗-'+stamp]) check(candidates.roleTitles.includes(label),'Used default/primary/secondary present in local candidates');
    const foreignAfter = await admin.api('GET',`/api/workspaces/${foreignWorkspace.id}/member-label-options`,undefined,foreignWorkspace.id);
    check(!foreignAfter.roleTitles.some(title=>title.includes(stamp)),'Used labels do not leak across workspaces');
    // 项目角色候选须按可见项目收口：普通成员看不到不可见项目的角色/兼岗标注。
    await put(rolePath(p1,u1.id),{roleTitle:'可见项目职能-'+stamp});
    await put(rolePath(p3,u1.id),{roleTitle:'隐藏项目职能-'+stamp,secondaryRoleTitles:['隐藏项目兼岗-'+stamp]});
    await grant(u1.id,p3,'none');
    const memberCandidates = await member.api('GET',wsPath('/member-label-options'),undefined,workspace.id);
    check(memberCandidates.roleTitles.includes('可见项目职能-'+stamp),'Member sees labels from a visible project');
    check(!memberCandidates.roleTitles.includes('隐藏项目职能-'+stamp)
      && !memberCandidates.roleTitles.includes('隐藏项目兼岗-'+stamp),'Member cannot see labels from a hidden project');
    check((await get(wsPath('/member-label-options'))).roleTitles.includes('隐藏项目职能-'+stamp),'Workspace owner still sees all project labels');
    await grant(u1.id,p3,'write');
    await admin.reject('GET',`/api/workspaces/${foreignWorkspace.id}/projects/${p1}/members`,undefined,404,foreignWorkspace.id);
    const foreignProjects = await admin.api('GET','/api/projects',undefined,foreignWorkspace.id,{limit:1});
    await admin.reject('POST',rolePath(p2)+'/copy',{sourceProjectId:foreignProjects.items[0].id,overwrite:true},404);
    await admin.reject('PUT',wsPath(`/projects/${foreignProjects.items[0].id}/member-roles/${u1.id}`),{roleTitle:'跨空间应拒绝'},404);
    await admin.reject('PUT',rolePath(p1,outsider.id),{roleTitle:'非成员应拒绝'},404);
  });

  await group('assignee roster: read allowed, none/viewer/nonmember denied, historical retention and project recheck', async () => {
    await setRole(u1.id,'member');
    await grant(u1.id,p1,'read');
    await grant(u1.id,p2,'read');
    await grant(u1.id,p3,'none');
    let r = await row(p1,u1.id);
    eq(r.access,'read','Read-only member remains a candidate');
    check(!(await roster(p1)).members.some(m=>m.userId===u2.id),'Viewer excluded from roster');
    check(!(await roster(p3)).members.some(m=>m.userId===u1.id),'Invisible member excluded from roster');
    const make = (pid,uid,title) => ({title,reqId:pid,ownerUserId:uid,boardColumn:'backlog',estimateMinutes:60});
    const readTask = await post('/api/tasks',make(p1,u1.id,'只读候选可指派'));
    eq([readTask.ownerUserId,readTask.reqId],[u1.id,p1],'Read-only assignee accepted by backend');
    for (const [pid,uid,title] of [[p3,u1.id,'不可见不得指派'],[p1,u2.id,'查看者不得指派'],[p1,outsider.id,'非成员不得指派']]) await admin.reject('POST','/api/tasks',make(pid,uid,title),400);
    await grant(u1.id,p1,'none');
    let updated = await put(`/api/tasks/${readTask.id}`,make(p1,u1.id,'历史负责人同项目保持'));
    eq([updated.ownerUserId,updated.reqId],[u1.id,p1],'Same assignee and same project retain historical binding after revoke');
    await admin.reject('PUT',`/api/tasks/${readTask.id}`,make(p3,u1.id,'换项目必须重验'),400);
    eq((await get(`/api/task/${readTask.id}`)).reqId,p1,'Rejected project change does not mutate task');
    updated = await put(`/api/tasks/${readTask.id}`,make(p2,u1.id,'换至可见只读项目允许'));
    eq(updated.reqId,p2,'Changed project with read visibility allowed');
    await setRole(u1.id,'viewer');
    updated = await put(`/api/tasks/${readTask.id}`,make(p2,u1.id,'历史查看者同项目保持'));
    eq(updated.ownerUserId,u1.id,'Historical viewer binding retained when project/assignee unchanged');
    await admin.reject('PUT',`/api/tasks/${readTask.id}`,make(p1,u1.id,'查看者换项目拒绝'),400);
    await admin.reject('POST','/api/tasks',make(p2,u1.id,'新查看者绑定拒绝'),400);
    await setRole(u1.id,'member');
    await grant(u1.id,p1,'write');
    await grant(u1.id,p2,'write');
    await grant(u1.id,p3,'write');
    const taskList = await get('/api/tasks/list',{limit:200});
    eq(taskList.total,1,'Rejected create attempts leave no extra tasks');
  });

  await group('ordinary member cannot write dictionaries/default function; project owner exception', async () => {
    const before = await get(wsPath('/member-label-options'));
    const beforeJob = (await get(wsPath('/members'))).find(m=>m.userId===u1.id).jobTitle;
    await member.reject('PUT',wsPath('/member-label-options'),{roleTitles:['越权字典'],companyNames:['越权公司']},403);
    await member.reject('PUT',wsPath(`/members/${u1.id}/job-title`),{jobTitle:'越权默认职能'},403);
    await member.reject('PUT',wsPath(`/members/${u3.id}/job-title`),{jobTitle:'越权他人职能'},403);
    await member.reject('PUT',rolePath(p1,u1.id),{roleTitle:'越权项目职能'},403);
    eq(await get(wsPath('/member-label-options')),before,'Unauthorized dictionary/default writes leave candidates unchanged');
    eq((await get(wsPath('/members'))).find(m=>m.userId===u1.id).jobTitle,beforeJob,'Default function unchanged after denied requests');
    await put(`/api/projects/${p3}`,{name:`API-${stamp}-restricted`,ownerUserId:u1.id});
    let personalRoster = await member.api('GET',wsPath(`/projects/${p3}/members`),undefined,workspace.id);
    eq(personalRoster.canEditRole,true,'Ordinary project owner may edit project roles');
    await member.api('PUT',rolePath(p3,u3.id),{roleTitle:'负责人授权职能',secondaryRoleTitles:['负责人兼岗']},workspace.id);
    eq((await row(p3,u3.id)).roleTitle,'负责人授权职能','Project owner save persisted');
    await member.reject('PUT',wsPath('/member-label-options'),{roleTitles:[],companyNames:[]},403);
    await member.reject('PUT',wsPath(`/members/${u1.id}/job-title`),{jobTitle:'负责人也不能改默认'},403);
    await setRole(u1.id,'viewer');
    personalRoster = await member.api('GET',wsPath(`/projects/${p3}/members`),undefined,workspace.id);
    eq(personalRoster.canEditRole,false,'Viewer project owner has no label write authority');
    await member.reject('PUT',rolePath(p3,u3.id),{roleTitle:'viewer越权'},403);
    await setRole(u1.id,'member');
  });

  await group('primary/secondary/company filters: task counts, report totals and exact scope', async () => {
    // Remove the earlier test task from the workload; it remains inside this space until cascade cleanup.
    for (const id of [...tasks]) await admin.api('DELETE',`/api/tasks/${id}`,undefined,workspace.id);
    await setJob(u1.id,'空间默认职能'); await setJob(u3.id,'实施顾问');
    await setCompany(u1.id,'验证公司甲'); await setCompany(u3.id,'验证公司乙');
    await put(rolePath(p1,u1.id),{roleTitle:'全栈工程师',secondaryRoleTitles:['测试']});
    await put(rolePath(p2,u1.id),{roleTitle:'产品经理',secondaryRoleTitles:['实施顾问']});
    await put(rolePath(p1,u3.id),{roleTitle:'',secondaryRoleTitles:[]});
    for (const [pid,uid,title,estimate] of [[p1,u1.id,'A主职能1',60],[p1,u1.id,'A主职能2',120],[p1,u3.id,'A公司乙',180],[p2,u1.id,'B主职能',240]]) {
      await post('/api/tasks',{title,reqId:pid,ownerUserId:uid,boardColumn:'backlog',estimateMinutes:estimate});
    }
    eq((await get('/api/tasks/list',{limit:200})).total,4,'Exactly four active fixture tasks');
    const cases = [
      [{},4,600],
      [{reqId:p1},3,360],
      [{reqId:p1,roleTitle:'全栈工程师'},2,180],
      [{reqId:p1,roleTitle:'测试'},2,180],
      [{reqId:p1,roleTitle:'空间默认职能'},0,0],
      [{reqId:p1,companyName:'验证公司乙'},1,180],
      [{companyName:'验证公司甲'},3,420],
      [{roleTitle:'实施顾问'},2,420],
      [{reqId:p2,roleTitle:'产品经理',companyName:'验证公司甲'},1,240],
      [{reqId:p1,roleTitle:'测试',companyName:'验证公司乙'},0,0]
    ];
    for (const [filter,count,estimate] of cases) {
      const expectedScope = {reqId:filter.reqId||null,roleTitle:filter.roleTitle||null,companyName:filter.companyName||null};
      const workload = await get('/api/manager/workload',filter);
      eq(workload.scope,expectedScope,'Workload returns exact applied scope');
      eq(workload.members.reduce((n,m)=>n+m.tasks.length,0),count,'Workload filtered task total '+JSON.stringify(filter));
      eq(workload.members.reduce((n,m)=>n+m.remainingMinutes,0),estimate,'Workload remaining estimate total '+JSON.stringify(filter));
      if (filter.reqId) check(workload.members.every(m=>m.tasks.every(t=>t.reqId===filter.reqId)),'No other-project tasks leak into project scope');
      const reports = await get('/api/manager/reports',filter);
      eq(reports.scope,expectedScope,'Reports return exact applied scope');
      eq(reports.burndown.totalEstimateMinutes,estimate,'Reports aggregate filtered task estimate');
      const last = reports.flow.weeks.at(-1);
      eq(last.backlog+last.doing+last.ended+last.done,count,'Report flow actual task total equals filter');
    }
    const p1Workload = await get('/api/manager/workload',{reqId:p1,roleTitle:'测试'});
    check(p1Workload.filterOptions.roleTitles.includes('测试') && p1Workload.filterOptions.roleTitles.includes('实施顾问'),'Filter options computed before active member filter');
    eq(p1Workload.members[0].effectiveRoleTitle,'全栈工程师','Single-project workload labels use project override');
    check(p1Workload.members[0].secondaryRoleTitles.includes('测试'),'Single-project workload secondary label retained');
    await grant(u1.id,p2,'none');
    await member.reject('GET','/api/manager/workload',undefined,404,workspace.id,{reqId:p2});
    await member.reject('GET','/api/manager/reports',undefined,404,workspace.id,{reqId:p2});
    const visible = await member.api('GET','/api/manager/workload',undefined,workspace.id);
    eq(visible.members.reduce((n,m)=>n+m.tasks.length,0),3,'Ordinary member workload excludes invisible project tasks');
    await grant(u1.id,p2,'write');
  });

  await group('activity and audit records with actor, action and workspace isolation', async () => {
    const activity = await get('/api/activity',{limit:200});
    const audit = await get('/api/admin/audit/logs',{size:100});
    check(Array.isArray(activity.items) && Array.isArray(audit.items),'Activity and audit page envelopes');
    check(activity.items.every(a=>a.workspaceId===workspace.id),'All activity records scoped to temporary workspace');
    check(audit.items.every(a=>a.workspaceId===workspace.id),'All audit records scoped to temporary workspace');
    for (const action of ['member_job_title','member_label_options','project_role']) check(audit.items.some(a=>a.action===action && a.result==='success' && a.actorId===admin.before.id),'Successful admin audit action '+action);
    check(audit.items.some(a=>a.action==='project_role' && a.actorId===u1.id && a.result==='success'),'Project owner audit actor recorded');
    for (const text of ['空间默认职能','替换成员标签字典','批量标注','复制项目','兼岗']) check(activity.items.some(a=>a.action==='config' && a.detail.includes(text)),'Activity includes '+text);
    check(!audit.items.some(a=>a.detail.includes('不得写入')||a.detail.includes('越权字典')),'Rejected label writes leave no success audit evidence');
  });
} catch (error) {
  errors.push({group:activeGroup,message:error.message,stack:error.stack});
  console.error('FATAL',error.stack);
} finally {
  if (workspace) {
    await group('cleanup: workspace/member/project/task deletion and unchanged account selection',async () => {
      const current = (await admin.api('GET','/api/workspaces')).find(w=>w.id===workspace.id);
      check(current?.name===workspaceName && current.ownerId===admin.before.id,'Delete ownership/name rechecked');
      await admin.api('DELETE',wsPath(''),undefined,workspace.id);
      eq((await admin.api('GET','/api/workspaces')).some(w=>w.id===workspace.id),false,'Admin workspace list no longer contains temporary space');
      for (const path of [wsPath('/members'),wsPath('/member-label-options'),'/api/projects','/api/tasks/list']) await admin.reject('GET',path,undefined,404);
      for (const id of projects) await admin.reject('GET',wsPath(`/projects/${id}/members`),undefined,404);
      for (const id of tasks) await admin.reject('GET',`/api/task/${id}`,undefined,404);
      const after = await admin.api('GET','/api/auth/me');
      eq([after.id,after.displayName,after.email,after.role,after.lastWorkspaceId],[admin.before.id,admin.before.displayName,admin.before.email,admin.before.role,admin.before.lastWorkspaceId],'Admin account/profile/selected demo workspace unchanged');
      if (member.before) {
        eq((await member.api('GET','/api/workspaces')).some(w=>w.id===workspace.id),false,'Added demo member no longer belongs to temporary space');
        const memberAfter = await member.api('GET','/api/auth/me');
        eq([memberAfter.id,memberAfter.displayName,memberAfter.email,memberAfter.role,memberAfter.lastWorkspaceId],[member.before.id,member.before.displayName,member.before.email,member.before.role,member.before.lastWorkspaceId],'Ordinary account/profile/selected workspace unchanged');
      }
      const finalUsers = await admin.api('GET','/api/admin/users',undefined,null,{limit:100});
      for (const before of [u1,u2,u3,outsider].filter(Boolean)) {
        const afterUser = finalUsers.items.find(u=>u.id===before.id);
        eq([afterUser.username,afterUser.role,afterUser.disabled,afterUser.displayName,afterUser.email,afterUser.lastWorkspaceId],[before.username,before.role,before.disabled,before.displayName,before.email,before.lastWorkspaceId],'Existing demo account unchanged: '+before.username);
      }
      check(writes.every(w=>w.workspaceId===workspace.id && !w.path.includes(PROTECTED)),'Every business write confined to new temporary workspace');
      clean = true;
    });
  }
  console.log('RESULT',JSON.stringify({assertions,businessAssertions,apiChecks,groups,errors,cleanup:clean,temporaryWorkspace:workspace?{id:workspace.id,name:workspace.name}:null,createdProjects:projects.size,createdTasks:tasks.size,writeCount:writes.length,notes:['No demo workspace writes, account/password changes, selects, rebuilds, restart, deployment or commits','Historical audit entries intentionally retained by application','Not covered: DB fault-injection, concurrency races, time-log totals and browser screenshots']}));
  if (errors.length || (workspace && !clean)) process.exitCode=1;
}
