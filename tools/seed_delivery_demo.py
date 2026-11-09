#!/usr/bin/env python3
import datetime as dt
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request


class Client:
    def __init__(self, base, username, password):
        self.base = base.rstrip('/')
        self.workspace = None
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.cookies))
        self.ok('GET', '/api/health')
        self.ok('POST', '/api/auth/login', form={'username': username, 'password': password})
        self.me = self.ok('GET', '/api/auth/me')

    def raw(self, method, path, body=None, params=None, form=None):
        params = dict(params or {})
        if self.workspace:
            params['workspace'] = self.workspace
        query = urllib.parse.urlencode(params)
        url = self.base + path + ('?' + query if query else '')
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
            with self.opener.open(req, timeout=45) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def ok(self, method, path, body=None, params=None, form=None):
        status, result = self.raw(method, path, body, params, form)
        if status != 200 or result.get('code') != 0:
            raise RuntimeError('{} {}: HTTP {} {}'.format(method, path, status, result.get('message')))
        return result.get('data')

    def upload(self, path, name, content):
        boundary = 'hourglass-' + secrets.token_hex(16)
        data = ('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: text/plain\r\n\r\n').encode() + content.encode() + ('\r\n--' + boundary + '--\r\n').encode()
        params = urllib.parse.urlencode({'workspace': self.workspace})
        headers = {'Content-Type': 'multipart/form-data; boundary=' + boundary,
                   'X-XSRF-TOKEN': next((c.value for c in self.cookies if c.name == 'XSRF-TOKEN'), '')}
        request = urllib.request.Request(self.base + path + '?' + params, data=data, headers=headers, method='POST')
        with self.opener.open(request, timeout=45) as response:
            result = json.loads(response.read())
        if result.get('code') != 0:
            raise RuntimeError('Attachment upload failed')
        return result['data']


class Demo:
    def __init__(self, client, manifest_path, prefix=None):
        self.client = client
        self.path = Path(manifest_path).absolute()
        repo = Path(__file__).resolve().parent.parent
        parent = self.path.parent.resolve(strict=True)
        if not parent.is_dir():
            raise RuntimeError('Manifest parent directory must already exist')
        if parent == repo or repo in parent.parents:
            raise RuntimeError('Credential manifest must remain outside the repository')
        # Pin the verified parent and retain our exclusively created inode: later saves
        # must never reopen a pathname that another process could replace.
        parent_fd = os.open(str(parent), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
            if os.open in os.supports_dir_fd:
                fd = os.open(self.path.name, flags, 0o600, dir_fd=parent_fd)
            else:
                # Some macOS Python builds lack openat. Use the canonical parent
                # and check its identity before writing any credential bytes.
                fd = os.open(str(parent / self.path.name), flags, 0o600)
                try:
                    if not os.path.samestat(os.stat(parent, follow_symlinks=False), os.fstat(parent_fd)):
                        raise RuntimeError('Manifest parent directory changed during creation')
                except BaseException:
                    os.close(fd)
                    raise
        finally:
            os.close(parent_fd)
        try:
            os.fchmod(fd, 0o600)
            self.output = os.fdopen(fd, 'w+', encoding='utf-8')
        except BaseException:
            os.close(fd)
            raise
        self.prefix = prefix or 'demo-' + dt.date.today().strftime('%Y%m%d') + '-' + secrets.token_hex(3)
        self.data = {'prefix': self.prefix, 'base': client.base, 'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                     'users': [], 'workspaces': [], 'counts': {}, 'complete': False}
        self.counts = self.data['counts']
        self.day = dt.date.today().isoformat()
        try:
            self.save()
        except BaseException:
            self.output.close()
            raise

    def save(self):
        payload = json.dumps(self.data, ensure_ascii=False, indent=2)
        self.output.seek(0)
        self.output.write(payload)
        self.output.truncate()
        self.output.flush()
        os.fsync(self.output.fileno())

    def close(self):
        self.output.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def create(self, kind, path, body, params=None):
        result = self.client.ok('POST', path, body, params)
        self.counts[kind] = self.counts.get(kind, 0) + 1
        return result

    def action(self, demand, name, **values):
        body = {'revision': demand.get('revision'), 'note': '模拟业务流程：' + name}
        body.update(values)
        return self.client.ok('POST', '/api/demands/' + demand['id'] + '/' + name, body)

    def plan(self, version, tasks, environment='production', coverage='full', targets=None):
        targets = targets or ['cluster-east', 'cluster-west']
        p = self.create('releasePlans', '/api/versions/' + version['id'] + '/release-plans', {
            'plannedAt': dt.datetime.now().replace(microsecond=0).isoformat(), 'ownerUserId': self.client.me['id'],
            'notes': '模拟发布窗口；实际范围须单独确认', 'risks': '先验证健康检查，再逐目标发布；异常回滚保留事实',
            'status': 'ready', 'reason': '创建独立模拟计划', 'plannedTaskIds': [t['id'] for t in tasks],
            'environment': environment, 'targetKeys': targets, 'coverage': coverage})
        return p

    def release(self, version, plan, tasks, environment='production', result='success', operation='deploy', related=None,
                coverage='full', targets=None, minutes_ago=0):
        body = {'planId': plan['id'] if plan else None,
                'occurredAt': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes_ago)).replace(microsecond=0).isoformat(),
                'environment': environment, 'targetKeys': targets or ['cluster-east', 'cluster-west'], 'coverage': coverage,
                'artifactRef': 'demo/' + self.prefix + '/' + version['id'],
                'artifactDigest': hashlib.sha256((self.prefix + version['id']).encode()).hexdigest(),
                'operation': operation, 'relatedReleaseId': related['id'] if related else None,
                'executorUserId': self.client.me['id'], 'actualTaskIds': [t['id'] for t in tasks],
                'deviationReason': '模拟实际事件：范围差异、紧急重部署或回滚按真实内容独立记录'}
        preview = self.client.ok('POST', '/api/versions/' + version['id'] + '/release-preview', body)
        body.update({'result': result, 'notes': '完整模拟数据；非真实外部部署',
                     'failureReason': '模拟健康检查失败' if result == 'failed' else None,
                     'idempotencyKey': secrets.token_hex(16), 'planRevision': preview.get('planRevision'),
                     'scopeToken': preview['scopeToken']})
        return self.create('releaseEvents', '/api/versions/' + version['id'] + '/release', body)

    def run(self, small=False):
        labels = ['项目负责人', '开发成员', '测试成员', '产品成员', '空间管理员', '只读成员', '无权限成员', '查看者']
        for index, label in enumerate(labels):
            password = secrets.token_urlsafe(18)
            username = self.prefix + '-u' + str(index + 1)
            user = self.create('users', '/api/admin/users', {'username': username, 'displayName': label,
                               'password': password, 'role': 'user'})
            self.data['users'].append({'id': user['id'], 'username': username, 'displayName': label, 'password': password})
            self.save()
        departments = [('支付业务部', ['支付网关', '结算平台', '风控中心']), ('电商事业部', ['交易服务', '营销平台', '库存系统']),
                       ('平台技术部', ['开放平台', '消息中心', '数据服务']), ('移动端团队', ['客户应用', '运营应用'])]
        if small:
            departments = [('发布验收演示', ['完整主路径'])]
        for department, projects in departments:
            ws = self.create('workspaces', '/api/workspaces', {'name': department + ' · ' + self.prefix[-6:]})
            entry = {'id': ws['id'], 'name': ws['name'], 'projects': []}
            self.data['workspaces'].append(entry)
            self.client.workspace = ws['id']
            self.save()
            for user in self.data['users']:
                self.client.ok('POST', '/api/workspaces/' + ws['id'] + '/members', {'username': user['username']})
            for index, role in [(4, 'admin'), (7, 'viewer')]:
                self.client.ok('PUT', '/api/workspaces/' + ws['id'] + '/members/' + self.data['users'][index]['id'] + '/role', {'role': role})
            for label in projects:
                project = self.create('projects', '/api/reqs', {'name': label, 'ownerUserId': self.data['users'][0]['id'],
                                      'description': '独立模拟项目；需求、执行、版本规划和正式发布事实分工演示'})
                row = {'id': project['id'], 'name': label, 'tasks': [], 'demands': [], 'versions': [], 'records': []}
                entry['projects'].append(row)
                for index, access in [(5, 'read'), (6, 'none')]:
                    self.client.ok('PUT', '/api/workspaces/' + ws['id'] + '/project-access',
                                   {'userId': self.data['users'][index]['id'], 'projectId': project['id'], 'access': access})
                categories = self.client.ok('GET', '/api/categories', params={'project': project['id']})
                category = categories[0]['id']
                versions = [self.create('versions', '/api/versions', {'reqId': project['id'], 'name': name,
                                       'startDate': self.day, 'targetDate': (dt.date.today() + dt.timedelta(days=14)).isoformat()})
                            for name in ['1.0 基础交付', '1.1 增量能力', '1.2 规划储备']]
                row['versions'] = versions
                demands = []
                for index, name in enumerate(['账户与权限', '核心业务流程', '监控与告警', '用户体验改进', '安全加固', '技术评估']):
                    demand = self.create('demands', '/api/demands', {'title': label + ' · ' + name, 'reqId': project['id'],
                                         'categoryId': category, 'priority': 'P' + str(index % 4), 'owner': '产品成员',
                                         'description': '价值：降低人工操作。验收：权限、异常、审计均有独立证据。'})
                    if index < 5:
                        demand = self.action(demand, 'pass')
                        if index < 4:
                            demand = self.action(demand, 'plan', versionId=versions[index % 2]['id'], plannedStart=self.day,
                                                 plannedEnd=(dt.date.today() + dt.timedelta(days=10)).isoformat())
                    demands.append(demand)
                row['demands'] = demands
                branch = self.create('branches', '/api/branches', {'name': 'feature/' + secrets.token_hex(4), 'reqId': project['id'],
                                     'ownerUserId': self.data['users'][1]['id'], 'owner': '开发成员', 'note': '分支状态不是实际部署证据'})
                epic = self.create('tasks', '/api/tasks', {'title': label + ' · 交付史诗', 'reqId': project['id'], 'categoryId': category,
                                   'itemType': 'epic', 'boardColumn': 'backlog', 'ownerUserId': self.data['users'][0]['id'], 'versionIds': []})
                tasks = []
                for index in range(24 if not small else 12):
                    done = index < 12 if not small else index < 6
                    body = {'title': label + ' · ' + ['接口实现', '异常测试', '性能优化', '可观测性'][index % 4] + ' ' + str(index + 1),
                            'reqId': project['id'], 'categoryId': category, 'description': '独立模拟工作项，发布徽标来自正式事件。',
                            'priority': 'P' + str(index % 4), 'ownerUserId': self.data['users'][1 + index % 3]['id'],
                            'owner': labels[1 + index % 3], 'boardColumn': 'done' if done else ('doing' if index % 3 else 'backlog'),
                            'itemType': 'bug' if index % 6 == 5 else ('story' if index % 4 == 0 else 'task'),
                            'versionIds': [versions[0 if done else 1]['id']] + ([versions[1]['id']] if index == 0 else []),
                            'versionChangeReason': '跨版本回移植规划', 'demandId': demands[index % 4]['id'], 'epicId': epic['id'],
                            'branchId': branch['id'], 'estimateMinutes': 120 + index * 10, 'startDate': self.day,
                            'dueDate': (dt.date.today() + dt.timedelta(days=3 + index % 10)).isoformat()}
                    if body['itemType'] == 'bug':
                        body.update({'severity': 'major', 'environment': '测试环境', 'reproduceSteps': '模拟请求超时，观察错误处理',
                                     'foundVersionId': versions[0]['id'], 'regressionStatus': 'pending'})
                    task = self.create('tasks', '/api/tasks', body)
                    tasks.append(task)
                    for subindex in range(2):
                        self.create('subtasks', '/api/tasks/' + task['id'] + '/subtasks', {'title': ['实现', '验证'][subindex]})
                    self.create('comments', '/api/tasks/' + task['id'] + '/comments', {'content': '模拟协作：本项已核对验收边界与依赖。'})
                    for days_ago in [1, 2, 3]:
                        day = dt.date.today() - dt.timedelta(days=days_ago)
                        while day.weekday() >= 5:
                            day -= dt.timedelta(days=1)
                        self.create('timeLogs', '/api/tasks/' + task['id'] + '/timer/manual', None,
                                    params={'forUserId': body['ownerUserId'], 'date': day.isoformat(), 'minutes': 30 + index % 5 * 10,
                                            'note': '模拟历史工作日投入，与发布次数独立'})
                row['tasks'] = tasks
                for index, name in enumerate(['产品需求说明', '技术实现方案', '测试验收记录', '运维发布指南']):
                    doc = self.create('documents', '/api/req-docs', {'reqId': project['id'], 'title': label + ' · ' + name,
                                      'docType': ['requirement', 'technical', 'acceptance', 'other'][index], 'status': 'active',
                                      'format': 'markdown', 'content': '# ' + name + '\n\n## 目标\n明确职责与验收边界。\n\n## 验证\n覆盖权限、失败、范围差异和回滚。'})
                    self.client.ok('POST', '/api/demands/' + demands[index]['id'] + '/docs', {'docId': doc['id']})
                cases = []
                for index in range(4):
                    case = self.create('testCases', '/api/test-cases', {'reqId': project['id'], 'demandId': demands[index]['id'],
                                       'title': label + ' · ' + ['正常路径', '权限拒绝', '失败重试', '范围回滚'][index], 'module': '交付验收',
                                       'priority': 'P1', 'precondition': '独立模拟环境',
                                       'steps': [{'action': '执行模拟业务操作', 'expected': '事实、状态与权限符合预期'}]})
                    cases.append(case)
                    self.create('testRuns', '/api/test-cases/' + case['id'] + '/runs', {'status': ['passed', 'passed', 'failed', 'blocked'][index], 'note': '模拟执行记录'})
                test_plan = self.create('testPlans', '/api/test-plans', {'reqId': project['id'], 'versionId': versions[1]['id'],
                                        'name': label + ' · 回归测试', 'plannedStart': self.day, 'status': 'draft'})
                self.client.ok('POST', '/api/test-plans/' + test_plan['id'] + '/cases', {'caseIds': [case['id'] for case in cases]})
                self.client.ok('PUT', '/api/test-plans/' + test_plan['id'] + '/status', params={'status': 'running'})
                self.client.upload('/api/tasks/' + tasks[0]['id'] + '/attachments', '模拟验收.txt', '这是独立模拟附件，不含业务凭据。')
                self.counts['attachments'] = self.counts.get('attachments', 0) + 1
                self.create('savedViews', '/api/views', {'name': label + ' · 待交付', 'params': json.dumps({'reqs': [project['id']], 'preset': 'doing', 'hideDone': True})})
                done_tasks = [task for task in tasks if task['boardColumn'] == 'done']
                p_test = self.plan(versions[0], done_tasks[:3], 'test')
                test_event = self.release(versions[0], p_test, done_tasks[:3], 'test', minutes_ago=1)
                p_prod = self.plan(versions[0], done_tasks[:3])
                failed = self.release(versions[0], p_prod, done_tasks[:2], result='failed')
                successful = self.release(versions[0], p_prod, done_tasks[:2], related=failed)
                gray_plan = self.plan(versions[0], done_tasks[2:4], coverage='partial', targets=['cluster-east'])
                gray = self.release(versions[0], gray_plan, done_tasks[2:4], coverage='partial', targets=['cluster-east'])
                redeploy = self.release(versions[0], None, done_tasks[:1], operation='redeploy', related=successful)
                rollback = self.release(versions[0], None, done_tasks[2:3], operation='rollback', related=gray,
                                        coverage='partial', targets=['cluster-east'])
                row['records'] = [test_event, failed, successful, gray, redeploy, rollback]
                self.plan(versions[1], tasks[-3:])
                row['demands'][3] = self.action(demands[3], 'cancel')
                self.save()
                print('SEEDED {} / {}'.format(department, label), flush=True)
        self.data['complete'] = True
        self.save()
        print('SEED COMPLETE ' + json.dumps(self.counts, ensure_ascii=False), flush=True)
        return self.data


def main():
    base = os.environ['SEED_BASE']
    if os.environ.get('ALLOW_DEMO_INSERT') != 'new-namespaced-data':
        raise RuntimeError('Explicit new-namespaced-data authorization is required')
    target = urllib.parse.urlparse(base)
    if target.scheme not in ('http', 'https') or target.username or target.query or target.fragment or target.path.rstrip('/') != '/hourglass':
        raise RuntimeError('Invalid explicitly supplied application target')
    client = Client(base, os.environ['SEED_USER'], os.environ['SEED_PASSWORD'])
    with Demo(client, os.environ['SEED_MANIFEST']) as demo:
        demo.run('--small' in sys.argv)


if __name__ == '__main__':
    main()
