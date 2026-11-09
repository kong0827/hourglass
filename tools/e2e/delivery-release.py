#!/usr/bin/env python3
"""Mandatory dedicated-instance release tests. Never starts services or seeds DB.

Requires PyMySQL, local root, and the revised API. Fault injection/concurrency/
JSON atomicity/DB restore are mandatory: missing prerequisites or unfinished
assertions FAIL. Only newly registered, proven run-owned fixtures are cleaned.
"""
import concurrent.futures
import contextlib
import copy
import datetime as dt
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

SCHEMA = 'hourglass_delivery_20261110'
EXACT_BASE = 'http://127.0.0.1:8121/hourglass'
BASE = os.environ.get('E2E_BASE', '')
MYSQL = '/usr/local/mysql/bin/mysql'
MYSQLDUMP = '/usr/local/mysql/bin/mysqldump'
DAY = dt.date.today().isoformat()
YESTERDAY = (dt.date.today() - dt.timedelta(days=1)).isoformat()


def guard():
    if os.environ.get('ALLOW_DELIVERY_TEST_WRITES') != SCHEMA:
        raise RuntimeError('Require ALLOW_DELIVERY_TEST_WRITES=' + SCHEMA)
    if BASE != EXACT_BASE:
        raise RuntimeError('Require E2E_BASE=' + EXACT_BASE + ' exactly')
    # ps may contain secrets: capture privately, never print its output. Only
    # inspect the two relevant listeners, not all system processes.
    for port, expected in ((8120, {'DB_HOST': '127.0.0.1', 'DB_PORT': '3307', 'DB_NAME': SCHEMA,
                                   'DB_USER': 'root', 'SERVER_PORT': '8120'}),
                           (8121, {'BACKEND_PORT': '8120', 'FRONTEND_PORT': '8121'})):
        result = subprocess.run(['lsof', '-nP', '-tiTCP:' + str(port), '-sTCP:LISTEN'], capture_output=True, text=True)
        pids = set(result.stdout.split())
        if result.returncode or len(pids) != 1 or not all(p.isdigit() for p in pids):
            raise RuntimeError('Cannot prove dedicated listener on ' + str(port))
        result = subprocess.run(['ps', 'eww', '-p', next(iter(pids)), '-o', 'command='], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('Cannot inspect dedicated listener on ' + str(port))
        env = result.stdout
        for key, value in expected.items():
            if re.findall(r'(?:^|\s)' + key + r'=([^\s]*)', env) != [value]:
                raise RuntimeError('Unproven process config: port {} {}'.format(port, key))
        if port == 8120:
            if re.findall(r'(?:^|\s)DB_PASSWORD=([^\s]*)', env) not in ([], ['']):
                raise RuntimeError('Require empty local DB password')
            if re.search(r'SPRING_DATASOURCE_|spring\.datasource\.|SPRING_APPLICATION_JSON|'
                         r'SPRING_CONFIG_(?:LOCATION|ADDITIONAL_LOCATION|IMPORT)|'
                         r'spring\.config\.(?:location|additional-location|import)', env):
                raise RuntimeError('Refuse unverified datasource/config override')
        del env, result
    print('GUARD exact local listeners/schema/datasource proven', flush=True)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, default=str, separators=(',', ':'))


def ident(value):
    if not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', value):
        raise RuntimeError('Unsafe SQL identifier')
    return '`' + value + '`'


def instant(minutes=2):
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes)).replace(microsecond=0).isoformat()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, username=None, password=None):
        username = username or os.environ.get('E2E_USER', 'admin')
        password = password if password is not None else os.environ.get('E2E_PASS', 'admin123')
        self.workspace = None
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                       urllib.request.HTTPCookieProcessor(self.cookies), NoRedirect())
        self.ok('GET', '/api/health')
        self.ok('POST', '/api/auth/login', form={'username': username, 'password': password})
        self.me = self.ok('GET', '/api/auth/me')

    def raw(self, method, path, body=None, params=None, form=None):
        params = dict(params or {})
        if self.workspace:
            params['workspace'] = self.workspace
        url = BASE + path + ('?' + urllib.parse.urlencode(params) if params else '')
        headers = {'X-XSRF-TOKEN': next((c.value for c in self.cookies if c.name == 'XSRF-TOKEN'), '')}
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode()
            headers['Content-Type'] = 'application/json'
        elif form is not None:
            data = urllib.parse.urlencode(form).encode()
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=50) as response:
                status, payload = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, payload = error.code, error.read()
        try:
            result = json.loads(payload)
        except (ValueError, UnicodeDecodeError):
            result = {'code': status, 'message': 'non-JSON response'}
        return status, result

    def ok(self, method, path, body=None, params=None, form=None):
        status, result = self.raw(method, path, body, params, form)
        if status != 200 or result.get('code') != 0:
            raise RuntimeError('{} {}: HTTP {} code {} {}'.format(method, path, status, result.get('code'), result.get('message')))
        return result.get('data')


class Suite:
    EVIDENCE = ('version_release_plan', 'version_release_plan_task', 'version_release', 'version_release_item', 'version_log')

    def __init__(self):
        import pymysql
        self.driver = pymysql
        self.db = self.connect()
        self.run_id = uuid.uuid4().hex[:12]
        self.prefix = 'e2e-' + self.run_id
        self.users, self.workspaces, self.triggers = {}, {}, {}
        self.restore_db = None
        self.workspace = self.admin = None
        self.actors = {}
        self.passed, self.failed, self.unverified, self.completed = [], [], [], []
        self.columns = {}
        for row in self.rows('SELECT TABLE_NAME AS t,COLUMN_NAME AS c FROM information_schema.columns WHERE TABLE_SCHEMA=%s', (SCHEMA,)):
            self.columns.setdefault(row['t'], set()).add(row['c'])
        self.fks = self.rows('SELECT TABLE_NAME AS child,COLUMN_NAME AS child_col,REFERENCED_TABLE_NAME AS parent,'
                            'REFERENCED_COLUMN_NAME AS parent_col FROM information_schema.KEY_COLUMN_USAGE '
                            'WHERE TABLE_SCHEMA=%s AND REFERENCED_TABLE_NAME IS NOT NULL', (SCHEMA,))
        self.prove_db()
        self.existing = self.rows('SELECT id,name,owner_id,type FROM workspace ORDER BY id')
        self.external_before = self.external_fingerprint()

    def connect(self, database=SCHEMA, autocommit=True):
        return self.driver.connect(host='127.0.0.1', port=3307, user='root', password='', database=database,
                    charset='utf8mb4', autocommit=autocommit, cursorclass=self.driver.cursors.DictCursor,
                    connect_timeout=8, read_timeout=60, write_timeout=60)

    def rows(self, sql, args=(), db=None):
        with (db or self.db).cursor() as cursor:
            cursor.execute(sql, args)
            return list(cursor.fetchall())

    def execute(self, sql, args=(), db=None):
        with (db or self.db).cursor() as cursor:
            return cursor.execute(sql, args)

    def prove_db(self):
        identity = self.rows('SELECT DATABASE() AS db,@@port AS port,CURRENT_USER() AS account')[0]
        if identity['db'] != SCHEMA or identity['port'] != 3307 or not identity['account'].startswith('root@'):
            raise RuntimeError('Cannot prove exact DB identity/schema/root/port')
        for table in self.EVIDENCE:
            if table not in self.columns or 'workspace_id' not in self.columns[table]:
                raise RuntimeError('New schema missing: ' + table)
        required = {'environment', 'occurred_at', 'target_keys', 'coverage', 'artifact_ref', 'artifact_digest',
                    'operation', 'related_release_id', 'executor_user_id'}
        if not required <= self.columns['version_release']:
            raise RuntimeError('New release record SQL fields incomplete')
        print('DB schema={} port=3307 root identity and new fields proven'.format(SCHEMA), flush=True)

    def check(self, name, condition, detail=None):
        (self.passed if condition else self.failed).append(name)
        print(('PASS ' if condition else 'FAIL ') + name +
              (' / ' + canonical(detail) if not condition and detail is not None else ''), flush=True)
        return bool(condition)

    def fingerprint(self, tables=None, workspace=None, db=None, schema=SCHEMA):
        workspace = workspace or self.workspace
        data = {}
        # Security/export/import audit entries are intentionally recorded outside a
        # failed business transaction. They are not evidence/workflow side effects.
        selected = tables if tables is not None else sorted(t for t, c in self.columns.items()
                    if 'workspace_id' in c and t != 'audit_log')
        for table in selected:
            data[table] = sorted(canonical(row) for row in self.rows('SELECT * FROM {}.{} WHERE workspace_id=%s'.format(
                                 ident(schema), ident(table)), (workspace,), db))
        if tables is None and 'test_plan_case' in self.columns:
            data['test_plan_case'] = sorted(canonical(r) for r in self.rows('SELECT c.* FROM {0}.test_plan_case c '
                'JOIN {0}.test_plan p ON p.id=c.plan_id WHERE p.workspace_id=%s'.format(ident(schema)), (workspace,), db))
        return data

    def external_fingerprint(self):
        return {w['id']: self.fingerprint(workspace=w['id']) for w in getattr(self, 'existing', [])}

    def reject(self, name, actor, method, path, body=None, code=400, params=None, unchanged=True):
        before = self.fingerprint() if unchanged else None
        status, result = actor.raw(method, path, body, params)
        codes = (code,) if isinstance(code, int) else code
        self.check(name + ' / HTTP ' + '|'.join(map(str, codes)), status in codes and
                   (result.get('code') == status or result.get('status') == status),
                   {'http': status, 'code': result.get('code'), 'message': result.get('message')})
        if unchanged:
            self.check(name + ' / no business writes', self.fingerprint() == before)
        return result

    def new_workspace(self, label):
        # Workspace names are capped at 20 characters. Keep the complete random
        # namespace and a unique suffix rather than truncating descriptive labels.
        name = self.prefix + '-' + format(len(self.workspaces), '03d')
        if len(name) > 20 or self.rows('SELECT id FROM workspace WHERE name=%s', (name,)):
            raise RuntimeError('Fresh workspace namespace collision: ' + label)
        ws = self.admin.ok('POST', '/api/workspaces', {'name': name})
        proof = self.rows('SELECT name,owner_id,type FROM workspace WHERE id=%s AND name=%s AND owner_id=%s',
                          (ws['id'], name, self.admin.me['id']))
        if len(proof) != 1 or proof[0]['type'] != 'shared' or ws['id'] in self.workspaces or ws['id'] in {w['id'] for w in self.existing}:
            raise RuntimeError('Cannot prove fresh API workspace ID/name/owner/schema')
        self.workspaces[ws['id']] = proof[0]
        return ws

    @contextlib.contextmanager
    def use_workspace(self, wid):
        old, client_old = self.workspace, self.admin.workspace
        self.workspace = self.admin.workspace = wid
        try:
            yield
        finally:
            self.workspace, self.admin.workspace = old, client_old

    def set_role(self, actor, role):
        return self.admin.ok('PUT', '/api/workspaces/' + self.workspace + '/members/' + actor.me['id'] + '/role', {'role': role})

    def set_access(self, actor, access):
        return self.admin.ok('PUT', '/api/workspaces/' + self.workspace + '/project-access',
                            {'userId': actor.me['id'], 'projectId': self.project['id'], 'access': access})

    def setup(self):
        self.admin = Client()
        if self.rows('SELECT id FROM app_user WHERE username=%s', ('admin',)) != [{'id': self.admin.me['id']}]:
            raise RuntimeError('API/DB admin identity mismatch')
        for role in ('owner', 'other', 'twin', 'viewer', 'read', 'none', 'manager', 'privileged'):
            username = self.prefix + '-' + role
            display = self.prefix + ('-same' if role in ('owner', 'twin', 'manager') else '-' + role)
            if self.rows('SELECT id FROM app_user WHERE username=%s', (username,)):
                raise RuntimeError('Random fixture username exists')
            user = self.admin.ok('POST', '/api/admin/users', {'username': username, 'displayName': display,
                                 'password': 'Delivery123!', 'role': 'user'})
            if self.rows('SELECT username FROM app_user WHERE id=%s', (user['id'],)) != [{'username': username}]:
                raise RuntimeError('Created user proof failed')
            self.users[user['id']] = username
            for ws in self.rows('SELECT id,name,owner_id,type FROM workspace WHERE owner_id=%s', (user['id'],)):
                if ws['type'] != 'personal' or ws['id'] in {w['id'] for w in self.existing}:
                    raise RuntimeError('Unexpected workspace for new user')
                self.workspaces[ws['id']] = {k: ws[k] for k in ('name', 'owner_id', 'type')}
            actor = Client(username, 'Delivery123!')
            if actor.me['id'] != user['id']:
                raise RuntimeError('Created-user login mismatch')
            self.actors[role] = actor
        self.workspace = self.admin.workspace = self.new_workspace('business')['id']
        for actor in self.actors.values():
            self.admin.ok('POST', '/api/workspaces/' + self.workspace + '/members', {'username': actor.me['username']})
            actor.workspace = self.workspace
        self.set_role(self.actors['viewer'], 'viewer')
        self.set_role(self.actors['privileged'], 'admin')
        self.project = self.admin.ok('POST', '/api/reqs', {'name': self.prefix + '-project', 'ownerUserId': self.actors['manager'].me['id']})
        self.second = self.admin.ok('POST', '/api/reqs', {'name': self.prefix + '-destination'})
        self.category = self.category_for(self.project['id'])
        self.second_category = self.category_for(self.second['id'])
        self.set_access(self.actors['read'], 'read')
        self.set_access(self.actors['none'], 'none')
        self.check('eight distinct accounts with identical-display spoof fixtures', len({a.me['id'] for a in self.actors.values()}) == 8 and
                   self.actors['owner'].me['displayName'] == self.actors['twin'].me['displayName'])
        print('FIXTURES schema={} workspace={} project={} run={}'.format(SCHEMA, self.workspace, self.project['id'], self.run_id), flush=True)

    def category_for(self, project):
        return self.rows('SELECT id FROM category WHERE workspace_id=%s AND project_id=%s ORDER BY sort_order LIMIT 1', (self.workspace, project))[0]['id']

    def task(self, tid, actor=None):
        return (actor or self.admin).ok('GET', '/api/task/' + tid)

    def task_body(self, tid, **changes):
        t = self.task(tid)
        fields = ('title', 'description', 'priority', 'owner', 'ownerUserId', 'categoryId', 'boardColumn', 'startDate', 'dueDate',
                  'reqId', 'reqDocId', 'branchId', 'itemType', 'demandId', 'progress', 'estimateMinutes', 'note', 'isMilestone',
                  'epicId', 'severity', 'environment', 'reproduceSteps', 'foundVersionId', 'regressionStatus')
        body = {k: t.get(k) for k in fields}
        body.update(oldUpdatedAt=t.get('updatedAt'), versionIds=None)
        body.update(changes)
        return body

    def new_task(self, title, versions=None, demand=None, owner='owner', done=False, project=None, **extra):
        actor = self.actors[owner]
        # Fresh JSON/FK workspaces have no fixture members. Use their proven API
        # owner rather than referring to an account outside that workspace.
        if actor.workspace != self.workspace:
            actor = self.admin
        pid = project or self.project['id']
        body = {'title': self.prefix + '-' + title, 'reqId': pid, 'categoryId': self.category_for(pid), 'versionIds': versions,
                'owner': actor.me['displayName'], 'ownerUserId': actor.me['id'], 'demandId': demand,
                'boardColumn': 'done' if done else 'backlog', 'completedAt': YESTERDAY if done else None,
                'estimateMinutes': 60, 'startDate': YESTERDAY, 'dueDate': DAY, 'versionChangeReason': 'test explicit scope'}
        body.update(extra)
        return self.admin.ok('POST', '/api/tasks', body)

    def version(self, name, project=None):
        return self.admin.ok('POST', '/api/versions', {'name': name, 'reqId': project or self.project['id'], 'startDate': YESTERDAY, 'targetDate': DAY})

    def get_version(self, v):
        return next(x for x in self.admin.ok('GET', '/api/versions', params={'reqId': v['reqId']}) if x['id'] == v['id'])

    def edit_version(self, v, **changes):
        current = self.get_version(v)
        body = {k: current.get(k) for k in ('reqId', 'name', 'description', 'startDate', 'targetDate', 'status', 'revision')}
        body.update(changes)
        return self.admin.ok('PUT', '/api/versions/' + v['id'], body)

    def action(self, demand, name, actor=None, **changes):
        body = dict(revision=demand['revision'], note='integration ' + name)
        body.update(changes)
        return (actor or self.admin).ok('POST', '/api/demands/' + demand['id'] + '/' + name, body)

    def new_demand(self, title, version=None):
        d = self.admin.ok('POST', '/api/demands', {'title': self.prefix + '-' + title, 'reqId': self.project['id'], 'priority': 'P2', 'categoryId': self.category})
        d = self.action(d, 'pass')
        return self.action(d, 'plan', versionId=version, plannedStart=YESTERDAY, plannedEnd=DAY) if version else d

    def plan(self, v, tasks, actor=None, **changes):
        body = dict(status='ready', plannedAt=dt.datetime.now().replace(microsecond=0).isoformat(), ownerUserId=self.actors['owner'].me['id'],
                    notes='independent test plan', risks='local fault injection', reason='explicit test scope',
                    plannedTaskIds=[t['id'] for t in tasks], environment='production', targetKeys=['east', 'west'], coverage='full')
        if self.actors['owner'].workspace != self.workspace:
            body['ownerUserId'] = self.admin.me['id']
        body.update(changes)
        return (actor or self.admin).ok('POST', '/api/versions/' + v['id'] + '/release-plans', body)

    def edit_plan(self, v, plan, **changes):
        body = {k: plan.get(k) for k in ('id', 'revision', 'status', 'plannedAt', 'ownerUserId', 'notes', 'risks', 'plannedTaskIds', 'environment', 'targetKeys', 'coverage')}
        body['reason'] = 'test revision'
        body.update(changes)
        return self.admin.ok('PUT', '/api/versions/' + v['id'] + '/release-plan', body)

    def context(self, v, plan, tasks, **changes):
        body = dict(planId=plan['id'] if plan else None, occurredAt=instant(), environment=plan['environment'] if plan else 'production',
                    targetKeys=plan['targetKeys'] if plan else ['east', 'west'], coverage=plan['coverage'] if plan else 'full',
                    artifactRef='fixture/' + self.run_id + '/' + v['id'], artifactDigest=hashlib.sha256((self.run_id + v['id']).encode()).hexdigest(),
                    operation='deploy', relatedReleaseId=None, executorUserId=self.admin.me['id'], actualTaskIds=[t['id'] for t in tasks],
                    deviationReason='actual scope explicitly verified')
        body.update(changes)
        return body

    def preview(self, v, context, actor=None):
        return (actor or self.admin).ok('POST', '/api/versions/' + v['id'] + '/release-preview', context)

    def confirmation(self, v, context, result='success', actor=None):
        preview = self.preview(v, context, actor)
        if not re.fullmatch('[a-fA-F0-9]{64}', preview.get('scopeToken', '')):
            raise RuntimeError('Missing SHA-256 context token')
        return dict(copy.deepcopy(context), result=result, notes='isolated release assertion', failureReason='external test failure' if result == 'failed' else None,
                    idempotencyKey=uuid.uuid4().hex, planRevision=preview.get('planRevision'), scopeToken=preview['scopeToken'])

    def confirm(self, v, body, actor=None):
        return (actor or self.admin).ok('POST', '/api/versions/' + v['id'] + '/release', body)

    def event(self, v, plan, tasks, result='success', actor=None, **changes):
        return self.confirm(v, self.confirmation(v, self.context(v, plan, tasks, **changes), result, actor), actor)

    def records(self, v, actor=None, key=None):
        return (actor or self.admin).ok('GET', '/api/versions/' + v['id'] + '/release-records', params={'key': key} if key else None)

    def publication(self, tid, state, targets=None, absent=False):
        t = self.task(tid)
        states = (state,) if isinstance(state, str) else state
        self.check('publication contract ' + tid, isinstance(t.get('versionIds'), list) and isinstance(t.get('versionNames'), list) and
                   isinstance(t.get('publicationTargets'), list) and isinstance(t.get('everPublished'), bool) and t.get('publicationState') in states, t)
        if targets is not None:
            self.check('effective targets exact ' + tid, set(t.get('publicationTargets', [])) == set(targets), t.get('publicationTargets'))
        if absent:
            self.check('no production badge ' + tid, t.get('publishedAt') is None)
        return t

    def assert_projection(self, name, payload, tid, expected):
        matches = []
        def visit(value):
            if isinstance(value, dict):
                if value.get('id') == tid and 'boardColumn' in value:
                    matches.append(value)
                for nested in value.values():
                    visit(nested)
            elif isinstance(value, list):
                for nested in value:
                    visit(nested)
        visit(payload)
        fields = ('versionIds', 'versionNames', 'publicationState', 'everPublished', 'publicationTargets', 'publishedAt')
        self.check(name + ' shared task publication projection', bool(matches) and all(
                   all(t.get(k) == expected.get(k) for k in fields) for t in matches),
                   {'found': len(matches), 'task': tid})

    def fixture(self, label, count=2, **changes):
        v = self.version(label)
        tasks = [self.new_task(label + '-' + str(i), versions=[v['id']], done=True) for i in range(count)]
        return v, tasks, self.plan(v, tasks, **changes)

    def binding_and_schedule(self):
        v1, v2 = self.version('many-one'), self.version('many-two')
        d = self.new_demand('inheritance', v1['id'])
        t = self.new_task('null-inherits', demand=d['id'])
        unbound = self.new_task('empty-unbound', versions=[], demand=d['id'])
        self.check('null create inherits / [] explicit unbound', self.task(t['id'])['versionIds'] == [v1['id']] and self.task(unbound['id'])['versionIds'] == [])
        path = '/api/tasks/' + t['id']
        self.admin.ok('PUT', path, self.task_body(t['id'], title=self.prefix + '-null-keeps', versionIds=None))
        self.check('PUT null keeps memberships', self.task(t['id'])['versionIds'] == [v1['id']])
        self.reject('override requires reason', self.actors['owner'], 'PUT', path, self.task_body(t['id'], versionIds=[v1['id'], v2['id']]))
        self.reject('same-display unrelated account cannot override', self.actors['twin'], 'PUT', path,
                    self.task_body(t['id'], versionIds=[v1['id'], v2['id']], versionChangeReason='spoof'), code=403)
        saved = self.actors['owner'].ok('PUT', path, self.task_body(t['id'], versionIds=[v1['id'], v2['id']], versionChangeReason='owner backport'))
        self.check('M:N arrays/API/SQL exact', set(saved['versionIds']) == {v1['id'], v2['id']} and len(saved['versionNames']) == 2 and
                   len(self.rows('SELECT * FROM version_task WHERE workspace_id=%s AND task_id=%s', (self.workspace, t['id']))) == 2)
        stale = self.task_body(t['id'], versionIds=[], versionChangeReason='stale drawer')
        self.edit_version(v1, taskIds=[], taskChangeReason='remove own membership')
        self.check('version edit removes only THIS membership', self.task(t['id'])['versionIds'] == [v2['id']])
        self.reject('stale drawer after version-entry membership edit', self.actors['owner'], 'PUT', path, stale, code=409)
        self.edit_version(v1, taskIds=[t['id']], taskChangeReason='add own membership')
        self.check('version edit preserves other membership', set(self.task(t['id'])['versionIds']) == {v1['id'], v2['id']})
        before = self.fingerprint(('task', 'version_task'))
        replanned = self.action(d, 'replan', actor=self.actors['manager'], versionId=v2['id'], plannedStart=None, plannedEnd=None)
        self.check('replan only demand / nullable schedule dates', replanned['versionId'] == v2['id'] and replanned.get('plannedStart') is None and
                   replanned.get('plannedEnd') is None and self.fingerprint(('task', 'version_task')) == before)
        self.reject('stale demand revision', self.admin, 'POST', '/api/demands/' + d['id'] + '/replan', {'revision': d['revision'], 'versionId': v1['id'], 'note': 'stale'}, code=409)
        for role in ('owner', 'twin', 'viewer', 'read', 'none'):
            self.reject(role + ' cannot manage demand target', self.actors[role], 'POST', '/api/demands/' + d['id'] + '/replan',
                        {'revision': replanned['revision'], 'versionId': v1['id'], 'note': 'denied'}, code=(403, 404) if role == 'none' else 403)
        canceled = self.action(replanned, 'cancel')
        self.check('cancel keeps target/task memberships', canceled['status'] == 'canceled' and canceled['versionId'] == v2['id'] and self.fingerprint(('task', 'version_task')) == before)
        self.reject('canceled demand cannot accept new linked task', self.admin, 'POST', '/api/tasks',
                    {'title': self.prefix + '-invalid-link', 'reqId': self.project['id'], 'categoryId': self.category, 'demandId': d['id'], 'versionIds': None})
        restored = self.action(canceled, 'restore')
        self.check('restore clears planning not task memberships', restored['status'] == 'pass' and restored.get('versionId') is None and self.fingerprint(('task', 'version_task')) == before)
        self.actors['owner'].ok('PUT', path, self.task_body(t['id'], versionIds=[], versionChangeReason='clear all'))
        self.check('PUT [] unbinds all', self.task(t['id'])['versionIds'] == [] and not self.rows('SELECT * FROM version_task WHERE workspace_id=%s AND task_id=%s', (self.workspace, t['id'])))
        logs = self.rows("SELECT change_data FROM task_log WHERE workspace_id=%s AND task_id=%s AND action='version_change'", (self.workspace, t['id']))
        self.check('membership audit reason persisted', any('owner backport' in str(r['change_data']) for r in logs))
        normalized = self.admin.ok('PUT', path, self.task_body(t['id'],
                         versionIds=[v1['id'], v1['id']], versionChangeReason='duplicate input normalization'))
        self.check('array set semantics never duplicate task-version rows', normalized['versionIds'] == [v1['id']] and
                   len(self.rows('SELECT * FROM version_task WHERE workspace_id=%s AND task_id=%s',
                                 (self.workspace, t['id']))) == 1)

    def delete_and_epic_guards(self):
        v1, v2 = self.version('delete-one'), self.version('delete-two')
        t = self.new_task('delete-array', versions=[v1['id'], v2['id']])
        for v in (v1, v2):
            self.reject('each array reference protects version ' + v['id'], self.admin, 'DELETE', '/api/versions/' + v['id'], code=422)
        self.admin.ok('DELETE', '/api/tasks/' + t['id'])
        self.reject('trashed array membership protects deletion', self.admin, 'DELETE', '/api/versions/' + v2['id'], code=422)
        self.admin.ok('POST', '/api/tasks/' + t['id'] + '/restore')
        self.check('unpublished restore retains two memberships', set(self.task(t['id'])['versionIds']) == {v1['id'], v2['id']})
        self.admin.ok('PUT', '/api/tasks/' + t['id'], self.task_body(t['id'], versionIds=[], versionChangeReason='clear before delete'))
        d = self.action(self.new_demand('canceled-delete-target', v2['id']), 'cancel')
        self.reject('canceled demand target protects deletion', self.admin, 'DELETE', '/api/versions/' + v2['id'], code=422)
        self.action(d, 'restore')
        bug = self.new_task('found-version', versions=[], itemType='bug', severity='major', environment='test', reproduceSteps='fixture', foundVersionId=v2['id'], regressionStatus='pending')
        self.reject('foundVersion protects deletion', self.admin, 'DELETE', '/api/versions/' + v2['id'], code=422)
        self.admin.ok('PUT', '/api/tasks/' + bug['id'], self.task_body(bug['id'], foundVersionId=''))
        self.admin.ok('DELETE', '/api/versions/' + v2['id'])
        self.check('unreferenced unpublished version deletable', not any(x['id'] == v2['id'] for x in self.admin.ok('GET', '/api/versions', params={'reqId': self.project['id']})))
        epic = self.new_task('isolated-epic', versions=[], itemType='epic')
        child = self.new_task('epic-child', versions=[], epicId=epic['id'])
        self.reject('Epic with children cannot isolated cross-project move', self.admin, 'PUT', '/api/tasks/' + epic['id'],
                    self.task_body(epic['id'], reqId=self.second['id'], categoryId=self.second_category, versionIds=[], versionChangeReason='isolated move'))
        self.check('Epic/child remain in same project', self.task(epic['id'])['reqId'] == self.project['id'] and self.task(child['id'])['reqId'] == self.project['id'])
        cross = self.version('foreign-version', project=self.second['id'])
        self.reject('cross-project version binding', self.admin, 'PUT', '/api/tasks/' + child['id'], self.task_body(child['id'], versionIds=[cross['id']], versionChangeReason='foreign'))

    def authorization_and_plans(self):
        v, ts, p = self.fixture('authorization', ownerUserId=self.actors['other'].me['id'])
        self.check('GET release-plans explicit scope', any(x['id'] == p['id'] for x in self.admin.ok('GET', '/api/versions/' + v['id'] + '/release-plans')) and set(p['plannedTaskIds']) == {t['id'] for t in ts})
        ctx, path = self.context(v, p, ts), '/api/versions/' + v['id']
        body = self.confirmation(v, ctx)
        for role in ('owner', 'other', 'twin', 'viewer', 'read', 'none'):
            actor, codes = self.actors[role], (403, 404) if role == 'none' else 403
            self.reject(role + ' direct preview forbidden despite task/metadata ownership', actor, 'POST', path + '/release-preview', ctx, code=codes)
            self.reject(role + ' direct confirm forbidden', actor, 'POST', path + '/release', body, code=codes)
            self.reject(role + ' direct selected-plan edit forbidden', actor, 'PUT', path + '/release-plan',
                        dict(p, notes='unauthorized metadata owner edit', reason='denied'), code=codes)
            self.reject(role + ' direct plan create forbidden', actor, 'POST', path + '/release-plans', {k: p.get(k) for k in
                        ('status', 'plannedAt', 'ownerUserId', 'plannedTaskIds', 'environment', 'targetKeys', 'coverage')}, code=codes)
            if role != 'none':
                self.check(role + ' read history without release authority', isinstance(self.records(v, actor), list))
                t = self.task(ts[0]['id'], actor)
                self.check(role + ' cannot manually publish/unpublish', not t.get('canPublish') and not t.get('canUnpublish'))
        self.reject('none cannot deep link task', self.actors['none'], 'GET', '/api/task/' + ts[0]['id'], code=404)
        self.reject('none cannot read formal release records', self.actors['none'], 'GET', path + '/release-records', code=(403, 404))
        self.reject('none cannot read release plans', self.actors['none'], 'GET', path + '/release-plans', code=(403, 404))
        for field, value in (('plannedAt', None), ('ownerUserId', None), ('plannedTaskIds', [])):
            invalid = {k: p.get(k) for k in ('status', 'plannedAt', 'ownerUserId', 'plannedTaskIds', 'environment', 'targetKeys', 'coverage')}
            invalid[field] = value
            self.reject('ready plan needs ' + field, self.admin, 'POST', path + '/release-plans', invalid)
        self.reject('ready plan owner must be existing workspace member', self.admin, 'POST', path + '/release-plans',
                    dict(invalid, plannedTaskIds=[t['id'] for t in ts], ownerUserId=uuid.uuid4().hex))
        for operation in ('publish', 'unpublish'):
            for actor in (self.admin, self.actors['owner']):
                self.reject('removed manual ' + operation + ' ' + actor.me['id'], actor, 'POST', '/api/tasks/' + ts[0]['id'] + '/' + operation,
                            {'publishedOn': DAY, 'reason': 'obsolete route'}, code=(404, 405))
        for role in ('manager', 'privileged'):
            actor = self.actors[role]
            plan = self.plan(v, ts, actor=actor)
            self.check(role + ' independent plan and preview authorized', plan['id'] != p['id'] and bool(self.preview(v, self.context(v, plan, ts, executorUserId=actor.me['id']), actor)['scopeToken']))
            vv, tt, pp = self.fixture('authorized-' + role)
            recorded = self.event(vv, pp, tt, actor=actor, executorUserId=actor.me['id'])
            self.check(role + ' actual confirm authorized with recorder/executor snapshots',
                       recorded['result'] == 'success' and recorded['releasedBy'] == actor.me['id'] and
                       recorded['executorUserId'] == actor.me['id'])
        vv, tt, pp = self.fixture('nonmanager-executor')
        executor = self.actors['owner']
        recorded = self.event(vv, pp, tt, executorUserId=executor.me['id'])
        self.check('current nonmanager executor is metadata, recorder retains management authority',
                   recorded['releasedBy'] == self.admin.me['id'] and recorded['executorUserId'] == executor.me['id'])
        self.reject('completed plan status readonly', self.admin, 'PUT', path + '/release-plan', dict(p, status='completed', reason='forgery'))
        self.reject('stale plan revision', self.admin, 'PUT', path + '/release-plan', dict(p, revision=p['revision'] - 1, reason='stale'), code=409)
        changed = self.edit_plan(v, p, notes='plan metadata changed')
        self.reject('old token after plan metadata update', self.admin, 'POST', path + '/release', body, code=409)
        for status in ('draft', 'canceled'):
            plan = self.plan(v, ts, status=status)
            context = self.context(v, plan, ts, deviationReason=None)
            preview = self.preview(v, context)
            self.check(status + ' late-fact preview warns, no silent exclusion', preview['requiresDeviationReason'] and not preview['canPublish'] and set(preview['actualTaskIds']) == {t['id'] for t in ts})
            self.reject(status + ' actual confirm needs anomaly reason', self.admin, 'POST', path + '/release', self.confirmation(v, context), code=422)
        canceled = self.edit_plan(v, changed, status='canceled')
        self.check('plan cancel selected ID only', canceled['status'] == 'canceled' and any(x['id'] != canceled['id'] and x['status'] == 'ready' for x in self.admin.ok('GET', path + '/release-plans')))

    def context_validation_and_staleness(self):
        v, ts, p = self.fixture('context-CAS')
        ctx, path = self.context(v, p, ts), '/api/versions/' + v['id']
        invalids = {'future time': {'occurredAt': (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)).isoformat()},
                    'offset required': {'occurredAt': DAY + 'T01:00:00'}, 'bad environment': {'environment': 'prod'},
                    'artifact required': {'artifactRef': ''}, 'digest64 required': {'artifactDigest': 'sha256:bad'},
                    'executor unknown': {'executorUserId': uuid.uuid4().hex}, 'actual explicit': {'actualTaskIds': None},
                    'actual duplicate': {'actualTaskIds': [ts[0]['id'], ts[0]['id']]}, 'actual unknown': {'actualTaskIds': [uuid.uuid4().hex]},
                    'target duplicate': {'targetKeys': ['east', 'east']}, 'coverage invalid': {'coverage': 'all'},
                    'known empty targets': {'targetKeys': []}, 'rollback reference required': {'operation': 'rollback'},
                    'redeploy reference required': {'operation': 'redeploy'}, 'invalid operation': {'operation': 'publish'},
                    'emergency reason required': {'planId': None, 'deviationReason': None}}
        for name, changes in invalids.items():
            self.reject(name, self.admin, 'POST', path + '/release-preview', dict(ctx, **changes), code=(400, 403, 404, 422))
        missing_reason = dict(ctx, actualTaskIds=[ts[0]['id']], deviationReason=None)
        pr = self.preview(v, missing_reason)
        self.check('actual subset without reason preview warns', pr['requiresDeviationReason'] and not pr['canPublish'])
        self.reject('subset no reason confirm forbidden', self.admin, 'POST', path + '/release', self.confirmation(v, missing_reason), code=422)
        body = self.confirmation(v, ctx)
        for field, value in (('occurredAt', instant(4)), ('targetKeys', ['east']), ('coverage', 'partial'), ('artifactRef', ctx['artifactRef'] + '-changed'),
                             ('artifactDigest', 'f' * 64), ('executorUserId', self.actors['manager'].me['id']), ('actualTaskIds', [ts[0]['id']]),
                             ('deviationReason', 'changed explanation'), ('environment', 'staging'), ('planId', None)):
            self.reject('full token binds ' + field, self.admin, 'POST', path + '/release', dict(body, **{field: value}), code=409)
        for mutation in ('task', 'version', 'membership', 'effort', 'demand', 'executor-profile', 'project'):
            vv, tt, pp = self.fixture('stale-' + mutation)
            demand = self.new_demand('stale-demand', vv['id']) if mutation == 'demand' else None
            if demand:
                self.admin.ok('PUT', '/api/tasks/' + tt[0]['id'], self.task_body(tt[0]['id'], demandId=demand['id']))
            context = self.context(vv, pp, tt)
            if mutation == 'executor-profile':
                context['executorUserId'] = self.actors['privileged'].me['id']
            old = self.confirmation(vv, context)
            if mutation == 'task':
                self.admin.ok('PUT', '/api/tasks/' + tt[0]['id'], self.task_body(tt[0]['id'], title=self.prefix + '-changed-title'))
            elif mutation == 'version':
                self.edit_version(vv, description='metadata changed')
            elif mutation == 'membership':
                self.new_task('new-scope', versions=[vv['id']])
            elif mutation == 'effort':
                self.admin.ok('POST', '/api/tasks/' + tt[0]['id'] + '/timer/manual', params={'date': YESTERDAY, 'minutes': 7, 'note': 'stale work'})
            elif mutation == 'demand':
                self.action(demand, 'replan', versionId=vv['id'], plannedStart=DAY, plannedEnd=DAY)
            elif mutation == 'executor-profile':
                self.actors['privileged'].ok('PUT', '/api/auth/profile', {'displayName': self.prefix + '-executor-new'})
            else:
                self.admin.ok('PUT', '/api/reqs/' + self.project['id'], {'name': self.prefix + '-project-renamed', 'ownerUserId': self.actors['manager'].me['id']})
            self.reject('stale preview after ' + mutation, self.admin, 'POST', '/api/versions/' + vv['id'] + '/release', old, code=409)
        foreign = self.version('foreign-context', project=self.second['id'])
        other = self.new_task('foreign-actual', versions=[foreign['id']], project=self.second['id'], done=True)
        self.reject('actual cross project forbidden', self.admin, 'POST', path + '/release-preview', dict(ctx, actualTaskIds=[other['id']]), code=(400, 422))
        empty = self.context(v, p, [])
        empty_preview = self.preview(v, empty)
        self.check('explicit empty actual scope cannot claim delivery', empty_preview['actualTaskIds'] == [] and not empty_preview['canPublish'])
        self.reject('empty actual success forbidden', self.admin, 'POST', path + '/release', self.confirmation(v, empty), code=422)
        failed = self.event(v, p, ts, result='failed')
        retry = self.confirmation(v, self.context(v, p, ts, relatedReleaseId=failed['id']))
        self.reject('token binds relatedReleaseId even for valid retry', self.admin, 'POST', path + '/release', dict(retry, relatedReleaseId=None), code=409)
        self.reject('rollback cannot reference failed attempt', self.admin, 'POST', path + '/release-preview',
                    self.context(v, None, ts, operation='rollback', relatedReleaseId=failed['id']), code=(400, 422))
        rv, rt, rp = self.fixture('operation-token')
        previous = self.event(rv, rp, rt, occurredAt=instant(5))
        next_plan = self.plan(rv, rt)
        redeploy = self.confirmation(rv, self.context(rv, next_plan, rt, operation='redeploy', relatedReleaseId=previous['id']))
        self.reject('token binds operation/related context', self.admin, 'POST', '/api/versions/' + rv['id'] + '/release',
                    dict(redeploy, operation='deploy', relatedReleaseId=None), code=409)
        for field, value in (('idempotencyKey', ''), ('scopeToken', 'bad'), ('planRevision', None), ('result', 'unknown')):
            self.reject('confirm required field ' + field, self.admin, 'POST', '/api/versions/' + rv['id'] + '/release', dict(redeploy, **{field: value}))

    def actual_subset_failure_and_snapshot(self):
        v = self.version('actual-plan3-actual2')
        d = self.new_demand('immutable-demand', v['id'])
        ts = [self.new_task('actual-three-' + str(i), versions=[v['id']], demand=d['id'], done=True) for i in range(3)]
        p = self.plan(v, ts)
        target_only = self.new_demand('unselected-target-not-evidence', v['id'])
        target_task = self.new_task('target-only-without-actual', versions=[], demand=target_only['id'], done=True)
        self.admin.ok('POST', '/api/tasks/' + ts[0]['id'] + '/timer/manual', params={'date': YESTERDAY, 'minutes': 25, 'note': 'snapshot'})
        ctx, path = self.context(v, p, ts[:2]), '/api/versions/' + v['id']
        pr = self.preview(v, ctx)
        self.check('plan3 actual2 not auto-expanded', set(pr['plannedTaskIds']) == {t['id'] for t in ts} and set(pr['actualTaskIds']) == {t['id'] for t in ts[:2]})
        failed_body = self.confirmation(v, ctx, 'failed')
        self.reject('failure reason required', self.admin, 'POST', path + '/release', dict(failed_body, failureReason=''))
        before = self.fingerprint(('task', 'version_task', 'demand', 'project_version', 'version_release_plan', 'version_release_plan_task'))
        failed = self.confirm(v, failed_body)
        self.check('failure does not mutate plan/workflow/scope', failed['result'] == 'failed' and failed['publishedCount'] == 0 and self.fingerprint(tuple(before)) == before)
        for t in ts:
            self.publication(t['id'], 'unpublished', targets=[], absent=True)
        before = self.fingerprint()
        self.check('failed replay exact fact without effects', self.confirm(v, failed_body) == failed and self.fingerprint() == before)
        self.reject('same key different failure body conflict', self.admin, 'POST', path + '/release', dict(failed_body, notes='different'), code=409)
        body = self.confirmation(v, dict(ctx, relatedReleaseId=failed['id']))
        record = self.confirm(v, body)
        self.check('retry failure to success independent event', record['id'] != failed['id'] and record['relatedReleaseId'] == failed['id'])
        actual = [i for i in record['items'] if i['disposition'] == 'published']
        self.check('actual snapshots two selected only / one not-selected', {i['taskId'] for i in actual} == {t['id'] for t in ts[:2]} and
                   {i['taskId'] for i in record['items'] if i['disposition'] == 'not_selected'} == {ts[2]['id']})
        self.check('snapshot demand identity/target/work captured', any(i['taskId'] == ts[0]['id'] and i['demandId'] == d['id'] and i['demandTitle'] == d['title'] and
                   i['targetVersionId'] == v['id'] and i['workMinutes'] == 25 for i in actual))
        for t in ts[:2]:
            self.publication(t['id'], ('effective', 'partial'), targets=['east', 'west'])
        self.publication(ts[2]['id'], 'unpublished', targets=[], absent=True)
        self.publication(target_task['id'], 'unpublished', targets=[], absent=True)
        target_gantt = self.admin.ok('GET', '/api/demands/gantt', params={'reqId': self.project['id'], 'q': target_only['title'], 'limit': 100})
        target_row = next(x for x in target_gantt['items'] if x['demand']['id'] == target_only['id'])
        self.check('released demand target alone never manufactures actual release timeline',
                   not any(s['stage'] == 'release' for s in target_row['timeline']['stages']))
        projection = self.task(ts[0]['id'])
        query = {'reqs': self.project['id'], 'q': 'actual-three', 'doneScope': 'all', 'doneLimit': 100}
        for name, endpoint, params in (
                ('list', '/api/tasks/list', dict(query, limit=100)),
                ('done', '/api/tasks/done', query), ('board', '/api/board', query),
                ('version task options', '/api/versions/task-options', {'reqId': self.project['id']}),
                ('demand linked tasks', '/api/demands/' + d['id'] + '/tasks', {'limit': 100})):
            self.assert_projection(name, self.admin.ok('GET', endpoint, params=params), ts[0]['id'], projection)
        mine = self.actors['owner'].ok('GET', '/api/my-tasks', params={'q': 'actual-three', 'scope': 'all', 'limit': 100})
        self.assert_projection('my tasks', mine, ts[0]['id'], projection)
        completed = next(x for x in self.admin.ok('GET', path + '/release-plans') if x['id'] == p['id'])
        self.check('successful plan completed', completed['status'] == 'completed')
        self.reject('completed plan immutable', self.admin, 'PUT', path + '/release-plan', dict(completed, status='ready', notes='edit', reason='no'), code=409)
        before = self.fingerprint()
        self.check('success replay before completed readiness check', self.confirm(v, body) == record and self.fingerprint() == before)
        self.reject('same key different success result conflict', self.admin, 'POST', path + '/release', dict(body, result='failed', failureReason='different'), code=409)
        resolved = self.records(v, key=body['idempotencyKey'])
        self.check('GET key exact result resolution', resolved == [record] or resolved == record)
        self.reject('formal evidence guards version deletion', self.admin, 'DELETE', '/api/versions/' + v['id'], code=422)
        current_project = self.admin.ok('GET', '/api/reqs')
        project_name = next(x['name'] for x in current_project['items'] if x['id'] == self.project['id'])
        self.reject('formal evidence guards project deletion', self.admin, 'DELETE', '/api/reqs/' + self.project['id'], params={'confirm': project_name}, code=422)
        self.reject('formal membership cannot expand', self.admin, 'POST', '/api/tasks', {'title': self.prefix + '-frozen-add', 'reqId': self.project['id'], 'categoryId': self.category, 'versionIds': [v['id']]})
        self.reject('formal membership cannot shrink', self.admin, 'PUT', '/api/tasks/' + ts[0]['id'], self.task_body(ts[0]['id'], versionIds=[], versionChangeReason='frozen'))
        frozen = self.fingerprint(('version_release', 'version_release_item'))
        self.admin.ok('POST', '/api/tasks/' + ts[0]['id'] + '/reopen', {'reason': '验证发布事实与工作重开分离'})
        reopened = self.task(ts[0]['id'])
        self.check('formal delivery permits reopening and keeps actual badge', reopened['boardColumn'] != 'done' and reopened.get('publishedAt') is not None)
        self.admin.ok('POST', '/api/tasks/' + ts[0]['id'] + '/move',
                      {'column': 'doing', 'force': True, 'autoTimer': False, 'autoResume': False})
        self.admin.ok('POST', '/api/tasks/bulk-move',
                      {'ids': [ts[0]['id'], ts[2]['id']], 'column': 'backlog', 'force': True, 'autoTimer': False, 'autoResume': False})
        self.check('published work can move/bulk-move without revoking evidence',
                   self.task(ts[0]['id'])['boardColumn'] == 'backlog' and self.task(ts[0]['id']).get('publishedAt') is not None and
                   self.fingerprint(('version_release', 'version_release_item')) == frozen)
        self.admin.ok('PUT', '/api/tasks/' + ts[0]['id'], self.task_body(ts[0]['id'], title=self.prefix + '-after-release-title', ownerUserId=self.actors['other'].me['id'],
                      owner=self.actors['other'].me['displayName'], estimateMinutes=90))
        self.admin.ok('POST', '/api/tasks/' + ts[0]['id'] + '/timer/manual', params={'date': DAY, 'minutes': 15, 'note': 'after release effort'})
        canceled = self.action(self.admin.ok('GET', '/api/demands/' + d['id']), 'cancel')
        self.admin.ok('DELETE', '/api/tasks/' + ts[1]['id'])
        self.admin.ok('PUT', '/api/tasks/' + ts[0]['id'], self.task_body(ts[0]['id'], demandId=''))
        self.reject('frozen planned task physical purge guarded', self.admin, 'DELETE', '/api/tasks/' + ts[1]['id'] + '/purge', code=(400, 422))
        trashed = self.task(ts[1]['id'])
        self.assert_projection('trash', self.admin.ok('GET', '/api/trash', params={'limit': 100}), ts[1]['id'], trashed)
        self.admin.ok('POST', '/api/tasks/' + ts[1]['id'] + '/restore')
        self.check('formal task restore preserves arrays/badge/immutable fact',
                   self.task(ts[1]['id'])['versionIds'] == trashed['versionIds'] and self.task(ts[1]['id']).get('publishedAt') == trashed.get('publishedAt') and
                   self.fingerprint(('version_release', 'version_release_item')) == frozen)
        self.admin.ok('DELETE', '/api/tasks/' + ts[1]['id'])
        self.check('actual immutable after reopen/title/owner/effort/cancel/delete', self.fingerprint(('version_release', 'version_release_item')) == frozen)
        self.check('task history retained after reopen/delete', any(r['id'] == record['id'] and r['items'] == record['items'] for r in self.admin.ok('GET', '/api/tasks/' + ts[1]['id'] + '/release-records')))
        gantt = self.admin.ok('GET', '/api/demands/gantt', params={'reqId': self.project['id'], 'status': 'canceled', 'q': d['title'], 'limit': 100})
        row = next(x for x in gantt['items'] if (x.get('demand') or x).get('id') == canceled['id'])
        release_stages = [s for s in row['timeline']['stages'] if s['stage'] == 'release']
        self.check('canceled/detached/deleted demand uses immutable snapshot identity for actual timeline',
                   bool(release_stages) and any(s['end'] == record['publishedOn'] for s in release_stages))
        self.reject('formal evidence prevents JSON overwrite', self.admin, 'POST', '/api/import', {'tasks': [], 'reqs': []})
        self.reject('formal evidence prevents workspace deletion', self.admin, 'DELETE', '/api/workspaces/' + self.workspace)

    def environment_operations_and_targets(self):
        v, ts, p = self.fixture('multi-events', environment='test')
        test = self.event(v, p, ts, occurredAt=instant(30))
        for t in ts:
            self.publication(t['id'], 'unpublished', targets=[], absent=True)
        self.event(v, self.plan(v, ts, environment='staging'), ts, occurredAt=instant(25))
        for t in ts:
            self.publication(t['id'], 'unpublished', targets=[], absent=True)
        original = self.event(v, self.plan(v, ts), ts, occurredAt=instant(20))
        for t in ts:
            self.publication(t['id'], 'effective', targets=['east', 'west'])
        north = self.event(v, self.plan(v, ts, targetKeys=['north'], coverage='partial'), ts, occurredAt=instant(10))
        newer = self.event(v, self.plan(v, ts, targetKeys=['east'], coverage='partial'), ts, operation='redeploy', relatedReleaseId=original['id'], occurredAt=instant(8))
        self.check('real redeploy same artifact/prior fact reference', newer['operation'] == 'redeploy' and newer['relatedReleaseId'] == original['id'] and newer['artifactDigest'] == original['artifactDigest'])
        self.event(v, None, ts, operation='rollback', relatedReleaseId=original['id'], targetKeys=['east'], coverage='partial', occurredAt=instant(6), deviationReason='old east only')
        for t in ts:
            self.publication(t['id'], ('effective', 'partial'), targets=['east', 'west', 'north'])
        self.event(v, None, ts, operation='rollback', relatedReleaseId=newer['id'], targetKeys=['east'], coverage='partial', occurredAt=instant(4), deviationReason='current east only')
        for t in ts:
            self.publication(t['id'], 'partial', targets=['west', 'north'])
        self.event(v, None, ts, operation='rollback', relatedReleaseId=original['id'], targetKeys=['west'], coverage='partial', occurredAt=instant(3), deviationReason='west only')
        for t in ts:
            self.publication(t['id'], 'partial', targets=['north'])
        self.event(v, None, ts, operation='rollback', relatedReleaseId=north['id'], targetKeys=['north'], coverage='partial', occurredAt=instant(1), deviationReason='last production target')
        for t in ts:
            task = self.publication(t['id'], 'rolled_back', targets=[], absent=True)
            self.check('everPublished survives rollback ' + t['id'], task['everPublished'] is True)
        records = self.records(v)
        self.check('multiple events/plans/env/rollback allowed per version', len(records) == 9 and len({r['id'] for r in records}) == 9)
        self.reject('production rollback cannot reference test event', self.admin, 'POST', '/api/versions/' + v['id'] + '/release-preview',
                    self.context(v, None, ts, operation='rollback', relatedReleaseId=test['id']), code=(400, 422))
        self.reject('rollback targets must subset related event', self.admin, 'POST', '/api/versions/' + v['id'] + '/release-preview',
                    self.context(v, None, ts, operation='rollback', relatedReleaseId=original['id'], targetKeys=['unproven']), code=(400, 422))
        self.reject('immutable formal artifact cannot be swapped', self.admin, 'POST', '/api/versions/' + v['id'] + '/release-preview',
                    self.context(v, None, ts, operation='redeploy', relatedReleaseId=original['id'], artifactDigest='a' * 64), code=(400, 409, 422))
        sv, st, sp = self.fixture('rollback-task-subset')
        deployed = self.event(sv, sp, st)
        rollback = self.event(sv, None, st[:1], operation='rollback', relatedReleaseId=deployed['id'],
                              targetKeys=['east'], coverage='partial', deviationReason='only first task/east rolled back')
        self.check('rollback actual selection never expands to other tasks',
                   {i['taskId'] for i in rollback['items'] if i['disposition'] == 'rolled_back'} == {st[0]['id']})
        self.publication(st[0]['id'], 'partial', targets=['west'])
        self.publication(st[1]['id'], 'effective', targets=['east', 'west'])
        failed = self.event(sv, None, st[:1], result='failed', operation='rollback', relatedReleaseId=deployed['id'],
                            targetKeys=['west'], coverage='partial', deviationReason='external rollback failed')
        self.check('failed rollback remains an independent failed attempt', failed['result'] == 'failed' and failed['id'] != rollback['id'])
        self.publication(st[0]['id'], 'partial', targets=['west'])
        self.publication(st[1]['id'], 'effective', targets=['east', 'west'])

    def anomalies_unknown_and_readonly(self):
        v = self.version('anomaly')
        d = self.new_demand('target-not-evidence', v['id'])
        early = self.new_task('unfinished-anomaly', versions=[v['id']], demand=d['id'])
        late = self.new_task('completion-after-event', versions=[v['id']], done=True, completedAt=DAY)
        plan = self.plan(v, [early, late])
        ctx = self.context(v, plan, [early, late], occurredAt=(dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)).isoformat(), deviationReason=None)
        pr = self.preview(v, ctx)
        self.check('late/unfinished preview warns but retains actual selection', pr['requiresDeviationReason'] and not pr['canPublish'] and set(pr['actualTaskIds']) == {early['id'], late['id']})
        self.reject('anomalies require explanation at confirm', self.admin, 'POST', '/api/versions/' + v['id'] + '/release', self.confirmation(v, ctx), code=422)
        event = self.event(v, plan, [early, late], occurredAt=ctx['occurredAt'], deviationReason='late reported real external deployment')
        self.check('reasoned anomalies recorded not silently excluded', {i['taskId'] for i in event['items'] if i['disposition'] == 'published'} == {early['id'], late['id']})
        captured = next(i for i in event['items'] if i['taskId'] == early['id'])
        self.check('actual success snapshots unfinished work without fabricating completion',
                   captured['boardColumn'] == 'backlog' and captured.get('completedAt') is None and self.task(early['id'])['boardColumn'] == 'backlog')
        note = self.admin.ok('GET', '/api/versions/' + v['id'] + '/release-note')
        captured_work = next(t for t in note['tasks'] if t['id'] == early['id'])
        self.check('immutable release note counts captured work state, not publication as done',
                   note['totalCount'] == 2 and note['doneCount'] == 1 and captured_work['boardColumn'] == 'backlog' and captured_work.get('completedAt') is None)
        frozen = self.fingerprint(('version_release', 'version_release_item'))
        t = self.admin.ok('PUT', '/api/tasks/' + early['id'], self.task_body(early['id'], publishedAt=None, publishSource='manual', publishedReleaseId=None,
                          publicationState='unpublished', everPublished=False, publicationTargets=[]))
        self.check('readonly publication fields cannot be forged by PUT', t.get('publishedAt') is not None and t.get('everPublished') is True and
                   t.get('publicationState') in ('effective', 'partial') and self.fingerprint(('version_release', 'version_release_item')) == frozen)
        unselected = self.new_task('no-actual-target-not-badge', versions=[])
        self.publication(unselected['id'], 'unpublished', targets=[], absent=True)
        uv, ut, up = self.fixture('unknown-scope', coverage='unknown', targetKeys=[])
        unknown = self.event(uv, up, ut, deviationReason='external target scope unknown')
        self.check('unknown scope explicitly stored', unknown['coverage'] == 'unknown' and unknown['targetKeys'] == [])
        for task in ut:
            self.publication(task['id'], 'unknown', targets=[], absent=True)
        offset = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=10)).replace(microsecond=0)
        tv, tt, tp = self.fixture('UTC-offset', environment='test')
        record = self.event(tv, tp, tt, occurredAt=offset.astimezone(dt.timezone(dt.timedelta(hours=8))).isoformat())
        stored = self.rows('SELECT occurred_at FROM version_release WHERE workspace_id=%s AND id=%s', (self.workspace, record['id']))[0]['occurred_at']
        self.check('ISO offset normalized UTC occurrence distinct from arrival', stored == offset.replace(tzinfo=None))

    def pagination_and_hours(self):
        v1, v2 = self.version('stats-many-one'), self.version('stats-many-two')
        label = 'page-' + self.run_id
        ts = [self.new_task(label + '-' + str(i), versions=[v1['id'], v2['id']], done=True) for i in range(5)]
        for i, t in enumerate(ts):
            self.admin.ok('POST', '/api/tasks/' + t['id'] + '/timer/manual', params={'date': YESTERDAY, 'minutes': i + 1, 'note': 'no join amplification'})
        params = {'reqs': self.project['id'], 'q': label, 'versions': v1['id'] + ',' + v2['id'], 'doneScope': 'all'}
        pages = [self.admin.ok('GET', '/api/tasks/list', params=dict(params, offset=o, limit=2)) for o in (0, 2, 4)]
        tasks = [t for page in pages for t in page['items']]
        self.check('M:N paginated distinct totals/IDs', all(p['total'] == 5 for p in pages) and len(tasks) == 5 and {t['id'] for t in tasks} == {t['id'] for t in ts})
        self.check('list task projections enriched', all(set(t['versionIds']) == {v1['id'], v2['id']} and t['publicationState'] == 'unpublished' for t in tasks))
        done = self.admin.ok('GET', '/api/tasks/done', params=dict(params, doneLimit=100))
        self.check('done page no duplicated rows', done['matched'] == 5 and len(done['items']) == 5)
        board = self.admin.ok('GET', '/api/board', params=dict(params, doneLimit=100))
        self.check('board no duplicated rows', board['columns']['done']['matched'] == 5 and len(board['columns']['done']['items']) == 5)
        phase = self.admin.ok('GET', '/api/phase/stats', params={'reqId': self.project['id']})
        total = self.rows('SELECT COALESCE(SUM(tl.minutes),0) AS n FROM time_log tl JOIN task t ON t.id=tl.task_id AND t.workspace_id=tl.workspace_id '
                         'WHERE t.workspace_id=%s AND t.req_id=%s AND tl.ended_at IS NOT NULL AND t.deleted_at IS NULL', (self.workspace, self.project['id']))[0]['n']
        self.check('global hours no M:N/event amplification', (phase['mvp']['workMinutes'] or 0) + (phase['post']['workMinutes'] or 0) == total, {'sql': total, 'phase': phase})
        stats = self.admin.ok('GET', '/api/versions/stats', params={'reqId': self.project['id']})
        for v in (v1, v2):
            row = next(x for x in stats['versions'] if x['id'] == v['id'])
            self.check('current version exactly five tasks/15 minutes ' + v['id'], row['taskCount'] == 5 and row['workMinutes'] == 15)

    def sql_integrity(self):
        v, ts, p = self.fixture('SQL-plan-FKs')
        self.check('plan and task SQL foreign keys present', any(f['child'] == 'version_release_plan_task' and f['parent'] == 'version_release_plan' for f in self.fks) and
                   any(f['child'] == 'version_release_plan_task' and f['parent'] == 'task' for f in self.fks))
        ws = self.new_workspace('foreign-sql')
        with self.use_workspace(ws['id']):
            project = self.admin.ok('POST', '/api/reqs', {'name': self.prefix + '-foreign-project'})
            foreign = self.new_task('foreign-SQL-task', versions=[], project=project['id'])
        for name, values, expected in (('duplicate plan-task', (self.workspace, p['id'], ts[0]['id']), 1062),
                ('cross-workspace task', (self.workspace, p['id'], foreign['id']), 1452), ('cross-workspace plan', (ws['id'], p['id'], foreign['id']), 1452),
                ('missing plan', (self.workspace, uuid.uuid4().hex, ts[0]['id']), 1452)):
            before, code = self.fingerprint(), None
            self.db.begin()
            try:
                self.execute('INSERT INTO version_release_plan_task(workspace_id,plan_id,task_id) VALUES(%s,%s,%s)', values)
            except self.driver.MySQLError as error:
                code = error.args[0]
            finally:
                self.db.rollback()
            self.check(name + ' SQL rejected exact constraint', code == expected, code)
            self.check(name + ' SQL rollback unchanged', self.fingerprint() == before)

    @contextlib.contextmanager
    def trigger(self, label, table, statement, args):
        name = 'e2e_delivery_' + self.run_id + '_' + label
        if self.rows('SELECT TRIGGER_NAME FROM information_schema.triggers WHERE TRIGGER_SCHEMA=%s AND TRIGGER_NAME=%s', (SCHEMA, name)):
            raise RuntimeError('Trigger already exists; never adopt/drop it')
        # Mandatory: privilege failure is FAIL, not SKIP. Register successful CREATE only.
        self.execute('CREATE TRIGGER {}.{} BEFORE INSERT ON {}.{} FOR EACH ROW {}'.format(ident(SCHEMA), ident(name), ident(SCHEMA), ident(table), statement), args)
        proof = self.rows('SELECT ACTION_STATEMENT AS statement,EVENT_OBJECT_TABLE AS t FROM information_schema.triggers WHERE TRIGGER_SCHEMA=%s AND TRIGGER_NAME=%s', (SCHEMA, name))
        if len(proof) != 1 or proof[0]['t'] != table or self.prefix not in proof[0]['statement']:
            raise RuntimeError('Cannot prove own trigger definition')
        self.triggers[name] = proof[0]
        try:
            yield
        finally:
            self.drop_trigger(name)

    def drop_trigger(self, name):
        if name not in self.triggers or not name.startswith('e2e_delivery_' + self.run_id + '_'):
            raise RuntimeError('Refuse foreign trigger cleanup')
        proof = self.rows('SELECT ACTION_STATEMENT AS statement,EVENT_OBJECT_TABLE AS t FROM information_schema.triggers WHERE TRIGGER_SCHEMA=%s AND TRIGGER_NAME=%s', (SCHEMA, name))
        if proof != [self.triggers[name]]:
            raise RuntimeError('Own trigger definition changed')
        self.execute('DROP TRIGGER {}.{}'.format(ident(SCHEMA), ident(name)))
        del self.triggers[name]

    def transaction_rollback(self):
        v, ts, p = self.fixture('second-snapshot-rollback')
        body, before = self.confirmation(v, self.context(v, p, ts)), self.fingerprint()
        statement = ("BEGIN IF NEW.workspace_id=%s AND (SELECT COUNT(*) FROM version_release_item WHERE workspace_id=NEW.workspace_id "
                     "AND release_id=NEW.release_id)>=1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT=%s; END IF; END")
        with self.trigger('snapshot', 'version_release_item', statement, (self.workspace, self.prefix + ' second actual snapshot fault')):
            self.reject('mandatory second snapshot INSERT fault', self.admin, 'POST', '/api/versions/' + v['id'] + '/release', body, code=500)
            self.check('whole transaction rollback records/items/log/plan/task/workflow/notifications', self.fingerprint() == before)
            self.check('no partial event or badge after fault', not self.records(v) and all(self.task(t['id']).get('publishedAt') is None for t in ts))
        recovered = self.confirm(v, body)
        self.check('same key retry after SQL rollback succeeds fully', recovered['result'] == 'success' and len([i for i in recovered['items'] if i['disposition'] == 'published']) == 2)

    def concurrent(self, jobs):
        barrier = threading.Barrier(len(jobs))
        def run(job):
            barrier.wait(timeout=15)
            return job()
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            futures = [pool.submit(run, job) for job in jobs]
            return [f.result(timeout=80) for f in futures]

    def concurrency(self):
        clients = [Client(), Client()]
        for c in clients:
            c.workspace = self.workspace
        v, ts, p = self.fixture('same-key-race')
        body, path = self.confirmation(v, self.context(v, p, ts)), '/api/versions/' + v['id'] + '/release'
        tables = ('task_log', 'version_log', 'app_notification', 'work_activity')
        before = self.fingerprint(tables)
        results = self.concurrent([lambda: clients[0].raw('POST', path, body), lambda: clients[1].raw('POST', path, copy.deepcopy(body))])
        self.check('mandatory same-key concurrency both 200', all(s == 200 and r.get('code') == 0 for s, r in results), results)
        self.check('same-key concurrency exact same complete fact', results[0][1].get('data') == results[1][1].get('data'))
        events = self.records(v)
        self.check('same-key concurrency one record', len(events) == 1)
        if len(events) != 1:
            raise RuntimeError('Concurrent result cardinality invalid')
        items = self.rows('SELECT * FROM version_release_item WHERE workspace_id=%s AND release_id=%s', (self.workspace, events[0]['id']))
        self.check('same-key concurrency no duplicate actual rows', len(items) == len(events[0]['items']) == 2 and len({i['task_id'] for i in items}) == 2)
        after = self.fingerprint(tables)
        self.confirm(v, body)
        self.check('identical replay zero added logs/notifications/activity', self.fingerprint(tables) == after)
        deltas = {t: len(after[t]) - len(before[t]) for t in tables}
        sv, st, sp = self.fixture('single-event-control')
        single_before = self.fingerprint(tables)
        self.event(sv, sp, st)
        single_after = self.fingerprint(tables)
        self.check('two same-key requests side effects equal one control event', deltas == {t: len(single_after[t]) - len(single_before[t]) for t in tables}, deltas)
        # Legitimate different events have distinct plans/targets, not two stale
        # submissions against a single completed plan; both MUST be recorded.
        vv, tt, p1 = self.fixture('legitimate-key-race', targetKeys=['east'], coverage='partial')
        p2 = self.plan(vv, tt, targetKeys=['west'], coverage='partial')
        b1, b2 = self.confirmation(vv, self.context(vv, p1, tt)), self.confirmation(vv, self.context(vv, p2, tt))
        path = '/api/versions/' + vv['id'] + '/release'
        results = self.concurrent([lambda: clients[0].raw('POST', path, b1), lambda: clients[1].raw('POST', path, b2)])
        self.check('different legitimate keys concurrent both 200', all(s == 200 and r.get('code') == 0 for s, r in results), results)
        records = self.records(vv)
        self.check('different legitimate keys two immutable facts', len(records) == 2 and {r['idempotencyKey'] for r in records} == {b1['idempotencyKey'], b2['idempotencyKey']})
        for t in tt:
            self.publication(t['id'], ('effective', 'partial'), targets=['east', 'west'])

    def permission_revocation_wait(self):
        for action, restriction in (('confirm', 'viewer'), ('confirm', 'read'), ('plan', 'viewer'), ('binding', 'read'), ('reopen', 'read'), ('delete', 'viewer')):
            v, ts, p = self.fixture('wait-' + action + '-' + restriction)
            actor = self.actors['manager']
            if action == 'confirm':
                method, path = 'POST', '/api/versions/' + v['id'] + '/release'
                body = self.confirmation(v, self.context(v, p, ts, executorUserId=actor.me['id']), actor=actor)
            elif action == 'plan':
                method, path, body = 'PUT', '/api/versions/' + v['id'] + '/release-plan', dict(p, notes='waiting edit', reason='permission wait')
            elif action == 'binding':
                method, path, body = 'PUT', '/api/tasks/' + ts[0]['id'], self.task_body(ts[0]['id'], versionIds=[], versionChangeReason='permission wait')
            elif action == 'reopen':
                method, path, body = 'POST', '/api/tasks/' + ts[0]['id'] + '/reopen', {}
            else:
                method, path, body = 'DELETE', '/api/tasks/' + ts[0]['id'], None
            tables = [t for t, c in self.columns.items() if 'workspace_id' in c
                      and t not in ('workspace_member', 'project_member', 'audit_log')]
            before, mutex = self.fingerprint(tables), self.connect(autocommit=False)
            pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            try:
                proof = self.rows('SELECT id FROM requirement WHERE workspace_id=%s AND id=%s FOR UPDATE', (self.workspace, self.project['id']), mutex)
                if proof != [{'id': self.project['id']}]:
                    raise RuntimeError('Cannot prove own mutex')
                future = pool.submit(actor.raw, method, path, body)
                deadline, waiting = time.monotonic() + 12, False
                while time.monotonic() < deadline and not future.done():
                    locks = self.rows('SELECT l.LOCK_DATA AS data FROM performance_schema.data_lock_waits w '
                                     'JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID '
                                     'WHERE l.OBJECT_SCHEMA=%s AND l.OBJECT_NAME=%s', (SCHEMA, 'requirement'))
                    if any(self.project['id'] in str(r['data']) for r in locks):
                        waiting = True
                        break
                    time.sleep(0.03)  # bounded external lock polling, not failure retries
                self.check('revocation ' + action + ' proven project lock wait', waiting)
                if restriction == 'viewer':
                    self.set_role(actor, 'viewer')
                else:
                    self.set_access(actor, 'read')
                before = self.fingerprint(tables)
                self.check('revocation ' + action + ' request still waits after authorized permission update', not future.done())
                mutex.rollback()
                status, result = future.result(timeout=60)
                self.check('revocation ' + action + ' denied after mutex', status == 403 and result.get('code') == 403, {'http': status, 'code': result.get('code')})
                after = self.fingerprint(tables)
                self.check('revocation ' + action + ' no unauthorized delivery writes', after == before)
            finally:
                mutex.rollback()
                mutex.close()
                pool.shutdown(wait=True)
                if restriction == 'viewer':
                    self.set_role(actor, 'member')
                else:
                    self.set_access(actor, 'default')

    def json_roundtrip_and_import_rollback(self):
        source = self.new_workspace('json-source')
        with self.use_workspace(source['id']):
            project = self.admin.ok('POST', '/api/reqs', {'name': self.prefix + '-json-project'})
            old_project, old_category = self.project, self.category
            self.project, self.category = project, self.category_for(project['id'])
            try:
                v1, v2 = self.version('JSON-one'), self.version('JSON-two')
                planned = self.new_demand('json-planned', v1['id'])
                canceled = self.action(self.new_demand('json-canceled', v1['id']), 'cancel')
                ts = [self.new_task('json-task-' + str(i), versions=[v1['id'], v2['id']], demand=planned['id'], done=True) for i in range(3)]
                backup = self.admin.ok('GET', '/api/export')
                self.event(v1, self.plan(v1, ts), ts[:2])
                facts = self.fingerprint(self.EVIDENCE)
                self.reject('JSON frozen source export explicitly unsupported', self.admin, 'GET', '/api/export', code=400)
                self.check('JSON rejected frozen source retains formal evidence', self.fingerprint(self.EVIDENCE) == facts)
                exported = next(t for t in backup['tasks'] if t['id'] == ts[0]['id'])
                self.check('JSON new array format no scalar authority', set(exported['versionIds']) == {v1['id'], v2['id']} and 'versionId' not in exported)
                self.check('JSON version startDate exported', all(v.get('startDate') == YESTERDAY for v in backup['versions']))
                self.check('JSON no formal evidence or badges', all(k not in backup for k in ('releasePlans', 'releaseRecords', 'releaseItems', 'versionReleases')) and
                           all('publishedAt' not in t and 'publishedReleaseId' not in t for t in backup['tasks']))
                ds = {d['id']: d for d in backup['demands']}
                self.check('JSON planned/canceled dates/target/status', ds[canceled['id']]['status'] == 'canceled' and all(ds[d['id']]['plannedStart'] == YESTERDAY and
                           ds[d['id']]['plannedEnd'] == DAY and ds[d['id']]['versionId'] == v1['id'] for d in (planned, canceled)))
            finally:
                self.project, self.category = old_project, old_category
        destination = self.new_workspace('json-target')
        with self.use_workspace(destination['id']):
            self.admin.ok('POST', '/api/import', backup)
            imported = self.admin.ok('GET', '/api/export')
            iv = {v['name']: v for v in imported['versions']}
            mapped = {iv[v1['name']]['id'], iv[v2['name']]['id']}
            self.check('JSON version IDs remapped/startDate retained', not mapped & {v1['id'], v2['id']} and all(v.get('startDate') == YESTERDAY for v in imported['versions']))
            its = {t['title']: t for t in imported['tasks']}
            self.check('JSON all M:N memberships remapped', all(set(its[t['title']]['versionIds']) == mapped for t in ts))
            ids = {d['title']: d for d in imported['demands']}
            self.check('JSON canceled target and schedule restored', ids[canceled['title']]['status'] == 'canceled' and ids[canceled['title']]['versionId'] == iv[v1['name']]['id'] and
                       ids[canceled['title']]['plannedStart'] == YESTERDAY and ids[canceled['title']]['plannedEnd'] == DAY)
            self.check('JSON import planning only, no formal evidence', all(not rows for rows in self.fingerprint(self.EVIDENCE).values()))
            for t in its.values():
                self.publication(t['id'], 'unpublished', targets=[], absent=True)
            for field, invalid_value in (('plannedStart', 'not-a-date'), ('plannedEnd', (dt.date.today() - dt.timedelta(days=3)).isoformat())):
                invalid = copy.deepcopy(backup)
                next(d for d in invalid['demands'] if d['id'] == planned['id'])[field] = invalid_value
                self.reject('JSON invalid schedule ' + field + ' before overwrite', self.admin, 'POST', '/api/import', invalid)
            before = self.fingerprint()
            statement = ("BEGIN IF NEW.workspace_id=%s AND (SELECT COUNT(*) FROM task WHERE workspace_id=NEW.workspace_id)>=1 "
                         "THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT=%s; END IF; END")
            with self.trigger('import', 'task', statement, (self.workspace, self.prefix + ' midway JSON task import fault')):
                self.reject('mandatory midway SQL fault API import', self.admin, 'POST', '/api/import', backup, code=500)
                self.check('JSON outer transaction restores prior rows/keys', self.fingerprint() == before)
            self.admin.ok('POST', '/api/import', backup)
            self.check('JSON retry after fault complete', len(self.admin.ok('GET', '/api/export')['tasks']) == 3)
        with self.use_workspace(source['id']):
            self.check('JSON never mutates source immutable facts', self.fingerprint(self.EVIDENCE) == facts)

    def database_backup_restore(self):
        self.prove_db()
        if not Path(MYSQLDUMP).is_file() or not Path(MYSQL).is_file():
            raise RuntimeError('Mandatory mysqldump/mysql unavailable')
        name = 'hourglass_restore_' + self.run_id
        if self.rows('SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME=%s', (name,)):
            raise RuntimeError('Restore schema exists; never adopt/drop it')
        self.execute('CREATE DATABASE {} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'.format(ident(name)))
        self.restore_db = name
        restored = None
        try:
            restored = self.connect(database=name)
            empty_proof = (self.rows('SELECT DATABASE() AS db', db=restored) == [{'db': name}] and not
                           self.rows('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=%s', (name,)))
            self.check('restore database fresh/run-owned/empty', empty_proof)
            if not empty_proof:
                raise RuntimeError('Refuse restoring over an unproven/nonempty database')
            before = {w: self.fingerprint(self.EVIDENCE, workspace=w) for w in self.workspaces}
            all_facts = {t: sorted(canonical(r) for r in self.rows('SELECT * FROM {}.{}'.format(ident(SCHEMA), ident(t))))
                         for t in self.EVIDENCE}
            self.check('backup has real plans, memberships, attempts and actual snapshots',
                       all(bool(all_facts[t]) for t in self.EVIDENCE))
            with tempfile.TemporaryDirectory(prefix=self.prefix + '-dbbackup-') as tmp:
                os.chmod(tmp, 0o700)
                dump = Path(tmp) / 'snapshot.sql'
                fd = os.open(str(dump), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                safe_env = {k: v for k, v in os.environ.items() if k not in ('MYSQL_PWD', 'MYSQL_TEST_LOGIN_FILE')}
                with os.fdopen(fd, 'wb') as output:
                    result = subprocess.run([MYSQLDUMP, '--no-defaults', '-h127.0.0.1', '-P3307', '-uroot', '--single-transaction', '--no-tablespaces', SCHEMA],
                                            stdout=output, stderr=subprocess.PIPE, env=safe_env, timeout=120)
                if result.returncode:
                    raise RuntimeError('Mandatory mysqldump failed (stderr suppressed)')
                payload = dump.read_bytes()
                # No --databases; never replace USE original. Reject switching or
                # qualified original SQL before feeding only our new restore DB.
                if re.search(rb'(?im)^\s*(?:USE\s|CREATE\s+DATABASE|DROP\s+DATABASE)', payload) or SCHEMA.encode() + b'`.' in payload:
                    raise RuntimeError('Dump includes database switching/qualified original SQL')
                if b'e2e_delivery_' in payload:
                    raise RuntimeError('Fault trigger leaked into DB backup')
                with dump.open('rb') as input_file:
                    result = subprocess.run([MYSQL, '--no-defaults', '-h127.0.0.1', '-P3307', '-uroot', name], stdin=input_file,
                                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=safe_env, timeout=120)
                if result.returncode:
                    raise RuntimeError('Mandatory restore failed (stderr suppressed)')
                self.check('dump/temp local permissions protected', dump.stat().st_mode & 0o777 == 0o600 and Path(tmp).stat().st_mode & 0o777 == 0o700)
                print('BACKUP schema={} restore={} bytes={} sha256={}'.format(SCHEMA, name, len(payload), hashlib.sha256(payload).hexdigest()), flush=True)
                del payload
            for wid in self.workspaces:
                self.check('DB restore exact plans/plan_task/record/item/log rows/keys ' + wid,
                           self.fingerprint(self.EVIDENCE, workspace=wid, db=restored, schema=name) == before[wid])
            for table in self.EVIDENCE:
                restored_rows = sorted(canonical(r) for r in self.rows('SELECT * FROM {}.{}'.format(ident(name), ident(table)), db=restored))
                self.check('full-schema DB restore exact rows/keys ' + table, restored_rows == all_facts[table])
            self.check('DB restore never changes source facts', all(self.fingerprint(self.EVIDENCE, workspace=w) == before[w] for w in self.workspaces))
        finally:
            if restored:
                restored.close()
            self.drop_restore_db()

    def drop_restore_db(self):
        name = self.restore_db
        if name is None:
            return
        if name != 'hourglass_restore_' + self.run_id or name == SCHEMA:
            raise RuntimeError('Refuse foreign restore DB cleanup')
        if self.rows('SELECT SCHEMA_NAME AS name FROM information_schema.schemata WHERE SCHEMA_NAME=%s', (name,)) != [{'name': name}]:
            raise RuntimeError('Restore DB identity changed')
        self.execute('DROP DATABASE ' + ident(name))
        self.restore_db = None
        self.check('own restore DB removed', not self.rows('SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME=%s', (name,)))

    def cleanup(self):
        self.prove_db()
        for trigger in list(self.triggers):
            self.drop_trigger(trigger)
        self.drop_restore_db()
        self.check('existing workspace data unchanged before cleanup', self.external_fingerprint() == self.external_before)
        tables = {t for t, c in self.columns.items() if 'workspace_id' in c}
        deps = {t: set() for t in tables}
        for fk in self.fks:
            if fk['child'] in tables and fk['parent'] in tables and fk['child'] != fk['parent']:
                deps[fk['parent']].add(fk['child'])
        # Deliberately non-FK history relationships also require child-first cleanup.
        for parent, children in {
            'version_release': {'version_release_item'}, 'version_release_plan': {'version_release', 'version_release_plan_task'},
            'project_version': {'version_task', 'version_release', 'version_release_plan', 'version_log', 'demand', 'task'},
            'task': {'version_release_item', 'version_release_plan_task', 'version_task', 'task_log', 'time_log', 'task_completion_record', 'task_comment',
                     'subtask', 'task_tag', 'task_watch', 'attachment', 'task_dependency', 'task_baseline', 'test_case_run'},
            'demand': {'task', 'demand_log', 'demand_doc_link', 'test_case'}, 'test_case': {'test_case_run'},
            'requirement': {'task', 'demand', 'project_version', 'category', 'project_member', 'requirement_doc', 'test_plan'},
            'requirement_doc': {'requirement_doc_history', 'req_doc_comment', 'req_doc_share', 'demand_doc_link', 'task'},
            'dev_branch': {'dev_branch_log', 'task'}, 'category': {'task', 'demand'},
        }.items():
            if parent in tables:
                deps[parent].update(children & tables)
        ordered, pending = [], set(tables)
        while pending:
            leaves = sorted(t for t in pending if not deps[t] & pending)
            if not leaves:
                raise RuntimeError('Cleanup FK cycle; never disable foreign keys: ' + ','.join(sorted(pending)))
            ordered.extend(leaves)
            pending.difference_update(leaves)
        self.db.begin()
        try:
            for uid, username in self.users.items():
                if self.rows('SELECT username FROM app_user WHERE id=%s FOR UPDATE', (uid,)) != [{'username': username}] or not username.startswith(self.prefix + '-'):
                    raise RuntimeError('Refuse unproven user cleanup')
                if any(r['workspace_id'] not in self.workspaces for r in self.rows('SELECT workspace_id FROM workspace_member WHERE user_id=%s', (uid,))):
                    raise RuntimeError('New user joined foreign workspace; refuse cleanup')
            for wid, expected in self.workspaces.items():
                if self.rows('SELECT name,owner_id,type FROM workspace WHERE id=%s FOR UPDATE', (wid,)) != [expected] or (
                        expected['type'] != 'personal' and not expected['name'].startswith(self.prefix + '-')):
                    raise RuntimeError('Refuse unproven workspace cleanup')
                # Child without workspace_id selected via exact run-owned parent.
                self.execute('DELETE c FROM test_plan_case c JOIN test_plan p ON p.id=c.plan_id WHERE p.workspace_id=%s', (wid,))
                for parent in ('task', 'demand', 'requirement_doc', 'version_release', 'test_case'):
                    for row in self.rows('SELECT id FROM {} WHERE workspace_id=%s'.format(ident(parent)), (wid,)):
                        self.execute('DELETE FROM mail_delivery WHERE reference_id=%s', (row['id'],))
                for table in ordered:
                    # workspace_id is the identity component of composite self-FKs,
                    # not an ancestor pointer; including it would prevent every leaf.
                    self_fks = [f for f in self.fks if f['child'] == table and f['parent'] == table
                                and f['child_col'] != 'workspace_id']
                    if not self_fks and table == 'version_release' and 'related_release_id' in self.columns[table]:
                        self_fks = [{'child_col': 'related_release_id', 'parent_col': 'id'}]
                    if not self_fks and table == 'task' and 'epic_id' in self.columns[table]:
                        self_fks = [{'child_col': 'epic_id', 'parent_col': 'id'}]
                    if self_fks:
                        while True:
                            conditions = ' AND '.join('NOT EXISTS(SELECT 1 FROM {t} c WHERE c.{child}=p.{parent})'.format(
                                t=ident(table), child=ident(f['child_col']), parent=ident(f['parent_col'])) for f in self_fks)
                            leaves = self.rows('SELECT p.id FROM {} p WHERE p.workspace_id=%s AND {}'.format(ident(table), conditions), (wid,))
                            if not leaves:
                                break
                            for row in leaves:
                                self.execute('DELETE FROM {} WHERE workspace_id=%s AND id=%s'.format(ident(table)), (wid, row['id']))
                        if self.rows('SELECT workspace_id FROM {} WHERE workspace_id=%s LIMIT 1'.format(ident(table)), (wid,)):
                            raise RuntimeError('Self-reference cleanup cycle; refuse unsafe deletes')
                    else:
                        self.execute('DELETE FROM {} WHERE workspace_id=%s'.format(ident(table)), (wid,))
                if self.execute('DELETE FROM workspace WHERE id=%s AND name=%s AND owner_id=%s AND type=%s',
                                (wid, expected['name'], expected['owner_id'], expected['type'])) != 1:
                    raise RuntimeError('Exact workspace delete failed')
            for uid, username in self.users.items():
                for table in ('user_notification_preference', 'user_list_preference', 'app_notification'):
                    self.execute('DELETE FROM {} WHERE user_id=%s'.format(ident(table)), (uid,))
                self.execute("DELETE FROM audit_log WHERE actor_id=%s OR (target_type='user' AND target_id=%s)", (uid, uid))
                if self.execute('DELETE FROM app_user WHERE id=%s AND username=%s', (uid, username)) != 1:
                    raise RuntimeError('Exact user delete failed')
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise
        remaining = sum(len(self.rows('SELECT id FROM workspace WHERE id=%s', (w,))) for w in self.workspaces)
        remaining += sum(len(self.rows('SELECT id FROM app_user WHERE id=%s', (u,))) for u in self.users)
        remaining += sum(len(self.rows('SELECT workspace_id FROM {} WHERE workspace_id=%s'.format(ident(t)), (w,))) for t in tables for w in self.workspaces)
        self.check('cleanup exact registered users/workspaces/children only', remaining == 0)
        self.check('cleanup preserves existing workspace data', self.external_fingerprint() == self.external_before)
        print('CLEANUP schema={} users={} workspaces={} remaining={}'.format(SCHEMA, len(self.users), len(self.workspaces), remaining), flush=True)

    def run(self):
        self.setup()
        scenarios = (self.binding_and_schedule, self.delete_and_epic_guards, self.authorization_and_plans, self.context_validation_and_staleness,
                     self.actual_subset_failure_and_snapshot, self.environment_operations_and_targets, self.anomalies_unknown_and_readonly,
                     self.pagination_and_hours, self.sql_integrity, self.transaction_rollback, self.concurrency, self.permission_revocation_wait,
                     self.json_roundtrip_and_import_rollback, self.database_backup_restore)
        expected = [s.__name__ for s in scenarios]
        for scenario in scenarios:
            start = len(self.passed) + len(self.failed)
            print('SCENARIO ' + scenario.__name__, flush=True)
            try:
                scenario()
                self.completed.append(scenario.__name__)
            except Exception as error:
                self.failed.append(scenario.__name__ + ': ' + str(error))
                self.unverified.append(scenario.__name__ + ' unfinished assertions')
                print('FAIL scenario {}: {}'.format(scenario.__name__, error), flush=True)
            print('COUNT {} assertions={} passed={} failed={}'.format(scenario.__name__, len(self.passed) + len(self.failed) - start, len(self.passed), len(self.failed)), flush=True)
        self.check('all mandatory scenarios complete, no SKIP passes', self.completed == expected and not self.unverified)


def main():
    suite = None
    try:
        guard()
        suite = Suite()
        def interrupted(signum, frame):
            raise KeyboardInterrupt('signal ' + str(signum))
        signal.signal(signal.SIGTERM, interrupted)
        suite.run()
    except BaseException as error:
        print('ABORT ' + str(error), file=sys.stderr, flush=True)
        if suite is None:
            return 2
        suite.failed.append('setup/execution: ' + str(error))
        suite.unverified.append('aborted mandatory verification')
    finally:
        if suite:
            try:
                suite.cleanup()
            except BaseException as error:
                suite.failed.append('cleanup: ' + str(error))
                print('CLEANUP FAILED: ' + str(error), file=sys.stderr, flush=True)
            suite.db.close()
    print('RESULT ' + json.dumps({'passed': len(suite.passed), 'failed': len(suite.failed), 'unverified': suite.unverified, 'failures': suite.failed,
          'completedScenarios': suite.completed, 'run': suite.run_id, 'schema': SCHEMA}, ensure_ascii=False), flush=True)
    return 1 if suite.failed or suite.unverified else 0


if __name__ == '__main__':
    sys.exit(main())
