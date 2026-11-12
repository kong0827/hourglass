#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从《运营研发项目看板.xlsx》生成运营研发空间的种子数据 SQL。

用法：
    python tools/gen_kanban_seed.py --xlsx "C:/Users/F2041/Downloads/运营研发项目看板.xlsx" \
        --out sql/seeds/seed_kanban_ops.sql

说明：
    - 只写增删改：先按空间 SXk01 / 用户 Xku% 清理，再整体插入，可重复执行；
    - 历史任务没有工时数据，工时按任务起止日期合成（origin=manual），并在备注中标注；
    - 演示账号统一密码 hourglassdemo；admin 为系统管理员账号，zhangwei 为空间所有者。
"""

import argparse
import html
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

WS_ID = "SXk01"
WS_NAME = "运营研发中心"
PASSWORD_HASH = "$2b$10$0S47ukkQ1W402WRzzSl5a.Nyybz3zgRZDRONSCg9nTOn1SmIaTEmG"  # hourglassdemo
TODAY = date(2026, 11, 9)
FALLBACK_DT = datetime(2026, 6, 1, 9, 0, 0)

# 人员 -> 登录名（顺序即账号编号）
USERS = [
    ("张伟", "zhangwei", "admin"),
    ("施亚彬", "shiyabin", "user"),
    ("周劲松", "zhoujinsong", "user"),
    ("张亮", "zhangliang", "user"),
    ("程洪昌", "chenghongchang", "user"),
    ("马远", "mayuan", "user"),
    ("王越峰", "wangyuefeng", "user"),
    ("肖威", "xiaowei", "user"),
    ("周顺", "zhoushun", "user"),
    ("邱德华", "qiudehua", "user"),
    ("李楠", "linan", "user"),
    ("尼克狐", "nikehu", "user"),
    ("林潇", "linxiao", "user"),
    ("叶鑫", "yexin", "user"),
    ("缪佳豪", "miaojiahao", "user"),
    ("姜子豪", "jiangzihao", "user"),
    ("孙钰", "sunyu", "user"),
    ("吴旻", "wumin", "user"),
    ("张会朋", "zhanghuipeng", "user"),
    ("张屹铭", "zhangyiming", "user"),
    ("朱斌", "zhubin", "user"),
    ("杨蕾", "yanglei", "user"),
    ("姜千一", "jiangqianyi", "user"),
    ("冒张琦", "maozhangqi", "user"),
    ("刘恬恬", "liutiantian", "user"),
]
USER_ID = {}
USERNAME = {}
for i, (name, login, _role) in enumerate(USERS, 1):
    USER_ID[name] = "Xku%02d" % i
    USERNAME[name] = login
USER_ROLE = {name: role for name, _login, role in USERS}

# 仅保留开发成员进入种子；PM / 测试 / 设计等非开发成员不再生成账号与成员关系
KEEP_USERS = ["张伟", "施亚彬", "张亮", "程洪昌", "肖威"]
MEMBER_USERS = [u for u in USERS if u[0] in KEEP_USERS]

# 系统管理员账号：不参与任务分配，保证重灌库后仍可用 admin 登录
ADMIN_USER = ("Xku00", "admin", "管理员")

# 项目 -> 负责人 / 分支名 / 状态
PROJECT_LEAD = {
    "流程引擎": "施亚彬",
    "资金通": "张亮",
    "风控与合规": "程洪昌",
    "报表服务": "程洪昌",
    "API开放平台": "肖威",
    "消息中心": "肖威",
    "机构服务平台": "张伟",
    "AI知识库": "张亮",
    "小程序平台化": "施亚彬",
}


def keep_user(name, project=None):
    """非开发成员的数据归到项目开发负责人，避免任务/文档出现已删除账号。"""
    if name in KEEP_USERS:
        return name
    lead = PROJECT_LEAD.get(project or "", "施亚彬")
    return lead if lead in KEEP_USERS else "施亚彬"


PROJECT_SLUG = {
    "资金通": "zijintong",
    "流程引擎": "liuchengyinqing",
    "风控与合规": "fengkonghegui",
    "报表服务": "baobiaofuwu",
    "API开放平台": "api-open-platform",
    "消息中心": "xiaoxizhongxin",
    "机构服务平台": "jigoufuwu",
    "AI知识库": "ai-zhishiku",
    "小程序平台化": "xiaochengxu",
}
PROJECT_STATUS = {"进行中": "active", "已完成": "done", "未启动": "hold"}
MODULE_PROJECT_FALLBACK = {"合规管理": "流程引擎", "外接模块": "流程引擎"}

PRIORITY_MAP = {"最高": "P0", "高": "P1", "中": "P2", "低": "P3", "最低": "P3", "": "P2"}
SEVERITY_MAP = {"阻断": "blocker", "严重": "critical", "一般": "major", "轻微": "minor"}
TASK_STATE = {
    "未启动": ("backlog", 0, False),
    "进行中": ("doing", 40, False),
    "开发中": ("doing", 50, False),
    "开发完成": ("dev_done", 80, False),
    "已提测": ("submitted", 90, False),
    "测试中": ("testing", 85, False),
    "待发版": ("pending_release", 95, False),
    "待发布": ("pending_release", 95, False),
    "已发布": ("done", 100, True),
    "关闭": ("done", 100, True),
}
# 看板列（done 由 ColumnController 作为系统列追加，不落库）
BOARD_COLUMNS = [
    ("backlog", "待处理", "#c08a3e"),
    ("doing", "进行中", "#5b83ad"),
    ("dev_done", "开发完成", "#3370ff"),
    ("submitted", "已提测", "#722ed1"),
    ("testing", "测试中", "#d48806"),
    ("pending_release", "待发布", "#13c2c2"),
]
TESTER = "张亮"
REQ_STATUS = {
    "已发版": "done",
    "开发完成": "active",
    "已提测": "active",
    "待发版": "active",
    "开发中": "active",
    "待评估": "draft",
    "待排期": "draft",
    "暂不考虑": "draft",
    "": "draft",
}
DEMAND_STATUS = {
    "待评估": "review",
    "待排期": "pass",
    "开发中": "plan",
    "开发完成": "plan",
    "已提测": "plan",
    "待发版": "plan",
    "暂不考虑": "rej",
    "": "review",
}
CATEGORY_COLORS = ["#3370ff", "#389e0d", "#d48806", "#cf1322", "#13c2c2", "#722ed1",
                   "#eb2f96", "#8c8c8c", "#1d39c4", "#ad6800", "#08979c", "#531dab"]


# ---------------------------------------------------------------- 基础工具

def norm_text(value):
    if value is None:
        return ""
    return re.sub(r"[\r\n\t]+", " ", str(value)).strip()


def cut(value, limit):
    s = norm_text(value)
    return s if len(s) <= limit else s[: max(0, limit - 1)] + "…"


def sql_str(value, limit=None):
    if value is None:
        return "NULL"
    s = str(value)
    if limit:
        s = cut(s, limit)
    s = s.replace("\\", "\\\\").replace("'", "''").replace("\x00", "")
    return "'" + s + "'"


def sql_num(value):
    return "NULL" if value is None else str(int(value))


def sql_date(value):
    return "NULL" if value is None else "'" + value.strftime("%Y-%m-%d") + "'"


def sql_dt(value):
    return "NULL" if value is None else "'" + value.strftime("%Y-%m-%d %H:%M:%S") + "'"


def d(value):
    s = norm_text(value)
    if not s:
        return None
    for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%Y年%m月%d日", "%Y.%m.%d", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    if s.isdigit():
        try:
            return date(1899, 12, 30) + timedelta(days=int(s))
        except ValueError:
            return None
    return None


def dt(day, hour=9, minute=0):
    return datetime(day.year, day.month, day.day, hour, minute, 0)


def add_days(day, days):
    return day + timedelta(days=days)


def person(token):
    s = norm_text(token)
    s = re.split(r"[、,，]", s)[0].strip()
    return s.split("@")[0].strip()


def people(token):
    out = []
    for part in re.split(r"[,，、]", norm_text(token)):
        name = part.split("@")[0].strip()
        if name and name not in out:
            out.append(name)
    return out


def split_tokens(text):
    return [x.strip() for x in re.split(r"[,，]", norm_text(text)) if x.strip()]


def business_days(start, end):
    if start is None:
        start = end or date(2026, 6, 1)
    if end is None or end < start:
        end = start
    out = []
    cur = start
    while cur <= end and len(out) < 60:
        if cur.weekday() < 5:
            out.append(cur)
        cur += timedelta(days=1)
    return out or [start]


def hash_pick(key, mod, offset=0):
    h = 0
    for ch in str(key):
        h = (h * 131 + ord(ch)) & 0xFFFFFFFF
    return (h + offset) % mod


# ---------------------------------------------------------------- xlsx 解析

def col_index(ref):
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
        else:
            break
    return n - 1


def load_workbook(path):
    with zipfile.ZipFile(path) as zf:
        shared = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.iter(NS + "si"):
                shared.append("".join(t.text or "" for t in si.iter(NS + "t")))

        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_map = {r.get("Id"): r.get("Target") for r in rels}

        sheets = {}
        for sheet in wb.iter(NS + "sheet"):
            name = sheet.get("name")
            target = rel_map.get(sheet.get(RNS + "id"))
            if not target:
                continue
            target = target.lstrip("/")
            root = ET.fromstring(zf.read(target))
            rows = {}
            for row in root.iter(NS + "row"):
                rnum = int(row.get("r"))
                cells = {}
                for c in row.findall(NS + "c"):
                    ci = col_index(c.get("r"))
                    ctype = c.get("t")
                    if ctype == "inlineStr":
                        node = c.find(NS + "is")
                        text = "".join(t.text or "" for t in node.iter(NS + "t")) if node is not None else ""
                    elif ctype == "s":
                        v = c.find(NS + "v")
                        text = shared[int(v.text)] if v is not None and v.text else ""
                    else:
                        v = c.find(NS + "v")
                        text = v.text if v is not None and v.text is not None else ""
                    cells[ci] = norm_text(text)
                rows[rnum] = cells
            sheets[name] = [rows[k] for k in sorted(rows)]
        return sheets


def cell(row, idx):
    return row.get(idx, "") if row else ""


# ---------------------------------------------------------------- 数据装载

def build():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    print("读取工作簿…")
    sheets = load_workbook(args.xlsx)
    for name, rows in sheets.items():
        print("  %s: %d 行" % (name, len(rows)))

    project_rows = sheets.get("项目管理", [])[1:]
    module_rows = sheets.get("项目模块", [])[1:]
    req_rows = sheets.get("需求管理", [])[1:]
    task_rows = sheets.get("项目子任务管理", [])[2:]
    bug_rows = sheets.get("缺陷管理", [])[1:]
    release_rows = sheets.get("发版记录", [])[1:]

    # ---- 项目
    projects = []
    project_by_objective = {}
    for row in project_rows:
        name = norm_text(cell(row, 0))
        if not name:
            continue
        objective = cell(row, 2)
        modules = split_tokens(cell(row, 9))
        projects.append({
            "name": cut(name, 40),
            "objective": cut(objective, 400),
            "status": PROJECT_STATUS.get(cell(row, 3), "active"),
            "modules": modules,
        })
        project_by_objective[norm_text(objective)] = cut(name, 40)
    project_names = [p["name"] for p in projects]
    project_set = set(project_names)

    module_project = {}
    for p in projects:
        for m in p["modules"]:
            module_project[m] = p["name"]
    for row in module_rows:
        module = norm_text(cell(row, 0))
        if not module:
            continue
        proj = project_by_objective.get(norm_text(cell(row, 1)))
        if proj:
            module_project.setdefault(module, proj)
    for module, proj in MODULE_PROJECT_FALLBACK.items():
        module_project.setdefault(module, proj)
    # 项目模块表里出现的任务名 -> 模块（补全任务缺失的“关联模块”）
    task_module_hint = {}
    for row in module_rows:
        module = norm_text(cell(row, 0))
        for idx in (2, 3, 4):
            for token in split_tokens(cell(row, idx)):
                task_module_hint.setdefault(token, module)

    # ---- 发版记录 / 版本
    release_list = []
    for row in release_rows:
        day = d(cell(row, 0))
        if not day:
            continue
        release_list.append({
            "date": day,
            "content": cell(row, 1),
            "owner": keep_user(person(cell(row, 2)) or "张伟", "流程引擎"),
            "note": cell(row, 3),
            "explicit": norm_text(cell(row, 5)) or norm_text(cell(row, 4)),
        })
    release_list.sort(key=lambda x: x["date"])
    seq = 0
    for rel in release_list:
        if rel["explicit"]:
            rel["name"] = cut(rel["explicit"], 40)
        else:
            seq += 1
            rel["name"] = "V0.9.%d" % seq
    versions = []
    for i, rel in enumerate(release_list, 1):
        versions.append({
            "id": "Xkv%02d" % i,
            "project": "流程引擎",
            "name": rel["name"],
            "description": cut(rel["content"] + ("；" + rel["note"] if rel["note"] else ""), 500),
            "status": "released",
            "start": add_days(rel["date"], -30),
            "target": rel["date"],
            "released": rel["date"],
            "tokens": set(split_tokens(rel["content"])),
            "owner": rel["owner"],
        })
    planned_version = {
        "id": "Xkv%02d" % (len(versions) + 1),
        "project": "流程引擎",
        "name": "V1.2.0",
        "description": "外接与主机托管的下一批需求，规划中。",
        "status": "planned",
        "start": date(2026, 9, 1),
        "target": date(2026, 11, 30),
        "released": None,
        "tokens": set(),
        "owner": "张伟",
    }
    versions.append(planned_version)
    latest_release = release_list[-1]["date"] if release_list else date(2026, 8, 19)
    version_by_id = {v["id"]: v for v in versions}
    released_versions = [v for v in versions if v["status"] == "released"]
    latest_released = released_versions[-1] if released_versions else None

    # ---- 需求文档
    docs = []
    demand_rows = []
    doc_by_project_title = {}
    title_count = Counter()
    req_date_by_project = defaultdict(list)
    for idx, row in enumerate(req_rows, 1):
        title = cell(row, 0)
        if not title:
            continue
        module_tokens = split_tokens(cell(row, 2))
        module = module_tokens[0] if module_tokens else ""
        explicit = project_by_objective.get(norm_text(cell(row, 8)))
        project = explicit or module_project.get(module) or "流程引擎"
        raw_title = cut(title, 100)
        title_count[(project, raw_title)] += 1
        if title_count[(project, raw_title)] > 1:
            raw_title = cut(raw_title + "（%d）" % title_count[(project, raw_title)], 100)
        owner = person(cell(row, 1)) or person(cell(row, 7)) or PROJECT_LEAD.get(project, "施亚彬")
        if owner not in USER_ID:
            owner = PROJECT_LEAD.get(project, "施亚彬")
        owner = keep_user(owner, project)
        created = d(cell(row, 3)) or date(2026, 6, 1)
        status = REQ_STATUS.get(cell(row, 4), "draft")
        docs.append({
            "id": "Xkd%04d" % len(docs),
            "project": project,
            "title": raw_title,
            "title_key": norm_text(title),
            "description": cut(cell(row, 5), 2000) or raw_title,
            "module": module,
            "owner": owner,
            "created": created,
            "status": status,
            "raw_status": cell(row, 4),
            "priority": PRIORITY_MAP.get(cell(row, 10), "P2"),
            "proposer": keep_user(person(cell(row, 7)), project) if person(cell(row, 7)) else "",
            "workdays": sum_num(cell(row, 12)) + sum_num(cell(row, 13)) + sum_num(cell(row, 14)),
            "published": None,
        })
        doc_by_project_title.setdefault((project, raw_title), docs[-1])
        req_date_by_project[project].append(created)

    # 已发版需求：优先匹配发版内容，否则取项目最近一次发版
    for doc in docs:
        if doc["status"] == "done":
            matched = None
            for v in released_versions:
                if doc["title_key"] in v["tokens"]:
                    matched = v
                    break
            if matched:
                doc["published"] = matched["released"]
            elif released_versions:
                doc["published"] = latest_release
            else:
                doc["published"] = add_days(doc["created"], 45)
            if doc["published"] < doc["created"]:
                doc["published"] = doc["created"]
        elif doc["status"] == "active":
            doc["published"] = min(TODAY, add_days(doc["created"], 7))

    # ---- 任务
    tasks = []
    task_by_title = {}
    sort_counter = Counter()
    for idx, row in enumerate(task_rows, 1):
        title = cell(row, 0)
        if not title:
            continue
        module = split_tokens(cell(row, 11))
        module = module[0] if module else ""
        hinted = task_module_hint.get(norm_text(title))
        if not module and hinted:
            module = hinted
        explicit = project_by_objective.get(norm_text(cell(row, 5)))
        project = explicit or module_project.get(module) or ""
        req_title = norm_text(cell(row, 10))
        doc = None
        if req_title:
            for token in split_tokens(req_title):
                doc = doc_by_project_title.get((project, cut(token, 100))) if project else None
                if not doc:
                    for (proj, t), cand in doc_by_project_title.items():
                        if t == cut(token, 100) or t.startswith(cut(token, 100)):
                            doc = cand
                            break
                if doc:
                    break
        if doc:
            project = doc["project"]
        project = project or "流程引擎"
        if not module and doc:
            module = doc["module"]
        if not module:
            title_text = norm_text(title)
            for candidate in module_project:
                if candidate in ("其他", "外接模块", "合规管理"):
                    continue
                if candidate in title_text or candidate.replace("基础功能", "") in title_text:
                    module = candidate
                    break
            if not module:
                if "资金通" in title_text:
                    module = "资金监控"
                elif "风控" in title_text:
                    module = "风控预警"
                elif "oa" in title_text.lower() or "待办" in title_text:
                    module = "流程引擎基础功能"
                elif "外接" in title_text or "子账户" in title_text or "客户信息台账" in title_text:
                    module = "外接"
                elif "主机托管" in title_text:
                    module = "主机托管"
                elif "程序化" in title_text:
                    module = "程序化报备"
        module = module or "其他"
        if not explicit and not doc and module in module_project:
            project = module_project[module]

        status_raw = cell(row, 3)
        column, progress, done = TASK_STATE.get(status_raw, ("backlog", 0, False))
        owner = person(cell(row, 6)) or PROJECT_LEAD.get(project, "施亚彬")
        if owner not in USER_ID:
            owner = PROJECT_LEAD.get(project, "施亚彬")
        owner = keep_user(owner, project)
        start = d(cell(row, 7))
        due = d(cell(row, 8))
        completed = d(cell(row, 9))
        completed_raw = completed
        if done:
            completed = completed or due or (add_days(start, 7) if start else None) or date(2026, 8, 1)
            if start and completed < start:
                completed = start
            if not start:
                start = add_days(completed, -7)
            due = due or completed
        else:
            # 未发布任务的源表完成时间只代表阶段节点，不能当作完成时间
            completed = None
            # 源表缺计划起止时按今天兜底，按看板列给出不同的排期窗口，避免 due 集中导致过载
            if not start and not due:
                if column == "backlog":
                    start, due = add_days(TODAY, 7), add_days(TODAY, 42)
                elif column == "doing":
                    start, due = add_days(TODAY, -7), add_days(TODAY, 30)
                elif column in ("dev_done", "submitted", "testing"):
                    start, due = add_days(TODAY, -14), add_days(TODAY, 35)
                elif column == "pending_release":
                    start, due = add_days(TODAY, -14), add_days(TODAY, 38)
                else:
                    start, due = add_days(TODAY, -7), add_days(TODAY, 35)
            elif not start:
                start = add_days(due, -7)
            elif not due:
                due = add_days(start, 35)
            # open task 的 due 限定在 TODAY+30 ~ TODAY+42（约 23~31 个工作日），保证容量足够不过载
            min_due = add_days(TODAY, 30)
            max_due = add_days(TODAY, 42)
            if due < min_due:
                due = min_due
            if due > max_due:
                due = max_due
            if due < start:
                start = add_days(due, -7)
        priority = PRIORITY_MAP.get(cell(row, 2), "P2")
        item_type = "bug" if cell(row, 4) == "缺陷" else "task"
        sort_counter[column] += 1
        task = {
            "id": "Xkt%04d" % (len(tasks) + 1),
            "project": project,
            "title": cut(title, 60),
            "description": cut(cell(row, 1), 200),
            "module": module,
            "owner": owner,
            "start": start,
            "due": due,
            "completed": completed,
            "status_raw": status_raw,
            "column": column,
            "progress": progress,
            "priority": priority,
            "item_type": item_type,
            "doc": doc,
            "sort": sort_counter[column],
            "completed_raw": completed_raw,
            "estimate": None,
            "figma": None,
            "created": None,
            "branch": None,
            "demand": None,
            "extra": {},
        }
        created_day = (add_days(min(filter(None, [start, due])), -3)
                       if (start or due) else FALLBACK_DT.date())
        task["created"] = dt(created_day, 10, 0)
        if item_type == "bug":
            severity = {"P0": "critical", "P1": "major", "P2": "minor", "P3": "minor"}[priority]
            detail = norm_text(cell(row, 1)) or norm_text(title)
            task["extra"] = {
                "severity": severity,
                "environment": "测试环境",
                "steps": "\n".join([
                    "操作步骤：" + detail,
                    "预期结果：功能符合需求与设计预期",
                    "实际结果：" + norm_text(title),
                ]),
                "regression": "passed" if done else "pending",
                "creator": owner,
                "found": None,
            }
        tasks.append(task)
        task_by_title.setdefault(norm_text(title), task)

    # ---- 缺陷
    bug_index = 0
    for row in bug_rows:
        desc = cell(row, 0)
        if not desc:
            continue
        bug_index += 1
        module = split_tokens(cell(row, 1))
        module = module[0] if module else "外接"
        project = module_project.get(module, "流程引擎")
        status_raw = cell(row, 9)
        column, progress, done = TASK_STATE.get(status_raw, ("backlog", 0, False))
        if status_raw == "新建":
            column, progress, done = "backlog", 0, False
        if status_raw == "拒绝":
            column, progress, done = "done", 100, True
        owner = person(cell(row, 12)) or person(cell(row, 10)) or "张亮"
        if owner not in USER_ID:
            owner = "张亮"
        owner = keep_user(owner, project)
        created = d(cell(row, 11)) or FALLBACK_DT.date()
        fixed = d(cell(row, 13))
        ended = d(cell(row, 15))
        completed = (ended or fixed or created) if done else None
        priority = PRIORITY_MAP.get(cell(row, 3), "P2")
        steps = "\n".join([
            "操作步骤：" + norm_text(cell(row, 5)),
            "预期结果：" + norm_text(cell(row, 6)),
            "实际结果：" + norm_text(cell(row, 7)),
        ])
        sort_counter[column] += 1
        tasks.append({
            "id": "Xkt%04d" % (len(tasks) + 1),
            "project": project,
            "title": cut(desc, 60),
            "description": cut(desc, 200),
            "module": module,
            "owner": owner,
            "start": created,
            "due": completed or add_days(created, 3),
            "completed": completed,
            "status_raw": status_raw,
            "column": column,
            "progress": progress,
            "priority": priority,
            "item_type": "bug",
            "doc": None,
            "sort": sort_counter[column],
            "estimate": None,
            "figma": None,
            "created": dt(created, 10, 0),
            "branch": None,
            "demand": None,
            "extra": {
                "severity": SEVERITY_MAP.get(cell(row, 2), "major"),
                "environment": cut(cell(row, 4), 120),
                "steps": steps,
                "regression": "passed" if status_raw == "关闭" else ("failed" if status_raw == "拒绝" else "pending"),
                "creator": keep_user(person(cell(row, 10)), project) if person(cell(row, 10)) else "",
                "found": None,
            },
        })

    # ---- 生成 ID 映射与关联
    project_ids = {name: "Xkp%02d" % (i + 1) for i, name in enumerate(project_names)}
    branch_ids = {name: "Xkb%02d" % (i + 1) for i, name in enumerate(project_names)}

    # 版本挂任务
    version_tasks = []
    used_version_task = set()
    for task in tasks:
        if task["project"] != "流程引擎":
            continue
        title_key = norm_text(task["title"])
        doc_key = task["doc"]["title_key"] if task["doc"] else ""
        chosen = None
        for v in released_versions:
            if title_key in v["tokens"] or (doc_key and doc_key in v["tokens"]):
                chosen = v
                break
        if not chosen and task["completed"]:
            nearest = None
            for v in released_versions:
                gap = abs((v["released"] - task["completed"]).days)
                if gap <= 10 and (nearest is None or gap < nearest[0]):
                    nearest = (gap, v)
            if nearest:
                chosen = nearest[1]
        if chosen and task["id"] not in used_version_task:
            version_tasks.append((task["id"], chosen["id"]))
            used_version_task.add(task["id"])
        if chosen and task["extra"].get("found") is None and task["item_type"] == "bug":
            task["extra"]["found"] = chosen["id"]

    # 缺陷发现版本兜底
    for task in tasks:
        if task["item_type"] == "bug" and not task["extra"].get("found"):
            task["extra"]["found"] = latest_released["id"] if latest_released else None

    # 任务补充关联
    for task in tasks:
        task["branch"] = branch_ids.get(task["project"])
        if task["doc"]:
            task["doc"]["priority"] = task["priority"]

    # ---- 需求池（未发版需求）
    for doc in docs:
        if doc["status"] == "done":
            continue
        raw = doc["raw_status"]
        dem_status = DEMAND_STATUS.get(raw, "review")
        title = cut(doc["title"], 80)
        kind = "新功能"
        if re.search(r"修复|缺陷|BUG|bug|异常", title):
            kind = "缺陷"
        elif re.search(r"优化|调整|体验|改进|完善", title):
            kind = "体验优化"
        effort = doc["workdays"] or 5
        wsjf_effort = max(1, min(10, int(round(effort))))
        urgency = {"待评估": 5, "待排期": 6, "开发中": 9, "开发完成": 8,
                   "已提测": 9, "待发版": 10, "暂不考虑": 2, "": 4}.get(raw, 5)
        demand_rows.append({
            "id": "Xkq%03d" % (len(demand_rows) + 1),
            "doc": doc,
            "project": doc["project"],
            "title": title,
            "description": cut(doc["description"], 2000),
            "source": (doc["proposer"] or doc["owner"]) + " · 项目看板",
            "kind": kind,
            "priority": doc["priority"],
            "status": dem_status,
            "created": doc["created"],
            "expect": add_days(doc["created"], 60),
            "version": None,
            "note": "",
            "biz": {"P0": 9, "P1": 7, "P2": 5, "P3": 3}.get(doc["priority"], 5),
            "urgent": urgency,
            "risk": 5,
            "effort": wsjf_effort,
        })
    for dem in demand_rows:
        if dem["status"] == "plan" and dem["project"] == "流程引擎":
            dem["version"] = planned_version["id"]
            dem["expect"] = planned_version["target"]
            dem["note"] = "评审通过，已排入 %s。" % planned_version["name"]
        elif dem["status"] == "plan":
            dem["note"] = "评审通过，等待目标版本确认。"
        elif dem["status"] == "pass":
            dem["note"] = "评审通过，进入排期队列。"
        elif dem["status"] == "rej":
            dem["note"] = "评审结论：暂不考虑（资源与优先级原因）。"
        else:
            dem["note"] = "待评审。"
    demand_by_doc = {}
    for dem in demand_rows:
        demand_by_doc[id(dem["doc"])] = dem["id"]
    for task in tasks:
        if task["doc"]:
            task["demand"] = demand_by_doc.get(id(task["doc"]))

    # ---- 项目成员
    members = defaultdict(dict)
    tester = TESTER
    for project in project_names:
        lead = PROJECT_LEAD.get(project, "施亚彬")
        members[project][lead] = "pm"
        owners = Counter()
        for task in tasks:
            if task["project"] == project:
                owners[task["owner"]] += 1
        for name, _cnt in owners.most_common(4):
            members[project].setdefault(name, "dev")
        if project in ("机构服务平台", "AI知识库", "小程序平台化"):
            members[project]["张伟"] = "pm"
            members[project]["施亚彬"] = "read"

    # ---- 测试模块
    test_modules = {}
    for doc in docs:
        for token in split_tokens(doc["module"]):
            key = (doc["project"], cut(token, 50))
            if key not in test_modules:
                test_modules[key] = {
                    "id": "Xktm%02d" % (len(test_modules) + 1),
                    "project": key[0],
                    "name": key[1],
                    "sort": sum(1 for k in test_modules if k[0] == key[0]),
                }

    # ---- 测试用例
    cases = []
    case_by_doc = {}
    exec_date_default = latest_release
    for i, doc in enumerate(docs, 1):
        status = doc["status"]
        latest = None
        if status == "done":
            latest = "passed"
        elif status == "active":
            latest = "failed" if i % 7 == 3 else "passed"
        if latest:
            latest_at = dt(doc["published"] or exec_date_default, 17, 0)
        else:
            latest_at = None
        bug_candidate = None
        if latest == "failed":
            for task in tasks:
                if task["item_type"] == "bug" and task["project"] == doc["project"]:
                    bug_candidate = task["id"]
                    break
        case = {
            "id": "Xktc%04d" % len(cases),
            "doc": doc,
            "project": doc["project"],
            "title": cut("验证：" + doc["title"], 100),
            "precondition": "已完成开发并部署至测试环境，测试数据准备完毕。",
            "module": doc["module"] or "其他",
            "priority": doc["priority"],
            "latest": latest,
            "note": None if latest is None else ("核心路径通过" if latest == "passed" else "与需求描述不一致，已转缺陷"),
            "latest_at": latest_at,
            "latest_by": tester if latest else None,
            "bug": bug_candidate,
        }
        cases.append(case)
        case_by_doc[id(doc)] = case

    # ---- 测试计划
    plans = []
    plan_cases = []
    for project in project_names:
        proj_cases = [c for c in cases if c["project"] == project]
        if not proj_cases:
            continue
        ver = None
        for v in versions:
            if v["project"] == project:
                ver = v
        plan = {
            "id": "Xkplan%02d" % (len(plans) + 1),
            "project": project,
            "name": cut(project + " 回归测试计划", 100),
            "version": ver["id"] if ver else None,
            "start": min((c["latest_at"].date() for c in proj_cases if c["latest_at"]), default=date(2026, 8, 1)),
            "end": max((c["latest_at"].date() for c in proj_cases if c["latest_at"]), default=date(2026, 8, 15)),
            "status": "done" if any(p["name"] == project and p["status"] == "done" for p in projects) else "active",
            "owner": PROJECT_LEAD.get(project, "施亚彬"),
        }
        plans.append(plan)
        for idx, case in enumerate(proj_cases, 1):
            plan_cases.append({
                "id": "Xktpc%04d" % len(plan_cases),
                "plan": plan["id"],
                "case": case["id"],
                "result": case["latest"],
                "note": case["note"],
                "by": case["latest_by"],
                "at": case["latest_at"],
            })

    # ---- 任务工时 / 完成记录（历史数据按起止日期合成）
    time_logs = []
    completions = []
    done_tasks = [t for t in tasks if t["column"] == "done"]
    base_hours = {"P0": 40, "P1": 24, "P2": 12, "P3": 6}
    # open task 的预估工时取更小的值，避免初始化后成员过载
    open_base_hours = {"P0": 12, "P1": 8, "P2": 4, "P3": 2}
    for task in tasks:
        if task["column"] != "done":
            hours = open_base_hours.get(task["priority"], 4)
            if task["item_type"] == "bug":
                hours = 2
            task["estimate"] = hours * 60
            continue
        hours = base_hours.get(task["priority"], 12)
        if task["item_type"] == "bug":
            hours = 4
        total_minutes = hours * 60
        end = task["completed"] or task["due"] or date(2026, 8, 1)
        start = task["start"] or add_days(end, -5)
        if end < start:
            end = start
        days = business_days(start, end)
        per_day = 0 if not days else max(30, min(480, (total_minutes // len(days) // 30) * 30))
        if per_day <= 0:
            per_day = total_minutes
        remain = total_minutes
        first_start = None
        last_end = None
        for day in days:
            if remain <= 0:
                break
            chunk = min(per_day, remain, 480)
            begin = dt(day, 9, 0)
            finish = begin + timedelta(minutes=chunk)
            time_logs.append((task["id"], task["owner"], begin, finish, chunk))
            first_start = first_start or begin
            last_end = finish
            remain -= chunk
        if remain > 0 and last_end is not None:
            time_logs.append((task["id"], task["owner"], last_end, last_end + timedelta(minutes=remain), remain))
            last_end = last_end + timedelta(minutes=remain)
            remain = 0
        actual_minutes = total_minutes - remain
        task["estimate"] = actual_minutes
        completions.append({
            "task": task,
            "start": start,
            "end": end,
            "first": first_start or dt(start, 9, 0),
            "last": last_end or dt(end, 18, 0),
            "minutes": actual_minutes,
        })

    # ---- 输出
    out = []
    emit = out.append

    emit("-- ==========================================================================")
    emit("-- 运营研发项目看板种子数据")
    emit("-- 由 tools/gen_kanban_seed.py 从《运营研发项目看板.xlsx》生成，请勿手工修改")
    emit("-- 空间：SXk01 / 运营研发中心（shared）")
    emit("-- 演示账号：admin（系统管理员）/ zhangwei（空间所有者）/ 其余成员，统一密码 hourglassdemo")
    emit("-- 数据口径：")
    emit("--   * 需求管理 -> requirement_doc + 未发版需求进入 demand 需求池（按模块分组，文档多的项目创建模块目录）")
    emit("--   * 项目子任务管理 + 缺陷管理 -> task（缺陷映射为 item_type=bug）")
    emit("--   * 工作项只含任务与缺陷，不生成用户故事 / 史诗")
    emit("--   * 成员：admin 系统管理员 + 5 名研发成员；其余历史负责人统一归到项目负责人")
    emit("--   * 看板列：待处理 / 进行中 / 开发完成 / 已提测 / 测试中 / 待发布（完成列为虚拟列）")
    emit("--   * 任务起止日期缺失时按看板列状态补齐，保证开发开始与截止时间可统计")
    emit("--   * open task 预估工时取较小值（P0=12h/P1=8h/P2=4h/P3=2h），due 限定 30~42 天，避免过载")
    emit("--   * 无任务的项目不生成开发分支")
    emit("--   * 发版记录 -> project_version / version_task")
    emit("--   * 历史任务缺工时，time_log 按任务起止日期合成，备注标为“历史任务补记”")
    emit("-- ==========================================================================")
    emit("")
    emit("SET NAMES utf8mb4;")
    emit("SET FOREIGN_KEY_CHECKS = 0;")
    emit("START TRANSACTION;")
    emit("")

    # 清理
    cleanup = [
        "task_watch", "task_tag", "task_dependency", "task_baseline", "subtask",
        "task_comment", "task_log", "time_log", "task_completion_record",
        "version_task", "test_case_run", "test_case", "test_module", "test_plan",
        "requirement_doc_history", "req_doc_comment", "req_doc_share",
        "demand_doc_link", "demand_log", "demand",
        "dev_branch_log", "dev_branch", "project_version",
        "project_member", "task", "requirement_doc", "requirement",
        "category", "tag", "board_column", "workspace_priority",
        "audit_log", "work_activity", "attachment",
        "workspace_member", "workspace",
    ]
    emit("-- 幂等清理：只删除本空间与本批演示账号的数据")
    for table in cleanup:
        if table == "workspace":
            emit("DELETE FROM workspace WHERE id = '%s';" % WS_ID)
        else:
            emit("DELETE FROM %s WHERE workspace_id = '%s';" % (table, WS_ID))
    emit("DELETE FROM test_plan_case WHERE plan_id LIKE 'Xk%';")
    emit("DELETE FROM app_user WHERE id LIKE 'Xku%';")
    emit("")

    def insert(table, columns, rows):
        if not rows:
            return
        emit("-- %s（%d 行）" % (table, len(rows)))
        for i in range(0, len(rows), 200):
            chunk = rows[i:i + 200]
            emit("INSERT INTO %s (%s) VALUES" % (table, ", ".join(columns)))
            emit(",\n".join("  (" + ", ".join(r) + ")" for r in chunk) + ";")
        emit("")

    # 用户
    now = dt(TODAY, 10, 0)
    user_values = [[
        sql_str(ADMIN_USER[0]), sql_str(ADMIN_USER[1]), sql_str(PASSWORD_HASH), sql_str(ADMIN_USER[2]),
        sql_str("admin"), "0", "1", sql_str(WS_ID),
        sql_dt(datetime(2026, 6, 1, 9, 0)), sql_dt(now),
    ]]
    for name, login, role in MEMBER_USERS:
        uid = USER_ID[name]
        user_values.append([
            sql_str(uid), sql_str(login), sql_str(PASSWORD_HASH), sql_str(name),
            sql_str(role), "0", "1", sql_str(WS_ID),
            sql_dt(datetime(2026, 6, 1, 9, 0)), sql_dt(now),
        ])
    insert("app_user",
           ["id", "username", "password_hash", "display_name", "role", "disabled",
            "session_version", "last_workspace_id", "created_at", "updated_at"],
           user_values)

    # 空间与成员
    insert("workspace",
           ["id", "name", "type", "owner_id", "created_at", "updated_at"],
           [[sql_str(WS_ID), sql_str(WS_NAME), "'shared'", sql_str(USER_ID["张伟"]),
             sql_dt(datetime(2026, 6, 1, 9, 0)), sql_dt(now)]])
    wm = [[sql_str(WS_ID), sql_str(ADMIN_USER[0]), sql_str("admin"),
           sql_dt(datetime(2026, 6, 1, 10, 0))]]
    for name, _login, _role in MEMBER_USERS:
        wrole = "owner" if name == "张伟" else ("admin" if name == "施亚彬" else "member")
        wm.append([sql_str(WS_ID), sql_str(USER_ID[name]), sql_str(wrole),
                   sql_dt(datetime(2026, 6, 1, 10, 0))])
    insert("workspace_member", ["workspace_id", "user_id", "role", "created_at"], wm)

    # 看板列 / 分类 / 优先级 / 标签
    insert("board_column",
           ["id", "workspace_id", "name", "color", "sort_order", "created_at"],
           [[sql_str(cid), sql_str(WS_ID), sql_str(name), sql_str(color), str(i),
             sql_dt(datetime(2026, 6, 1, 9, 0))]
            for i, (cid, name, color) in enumerate(BOARD_COLUMNS)])

    category_names = []
    for module in module_project.keys():
        if module and module not in category_names:
            category_names.append(module)
    category_names.append("其他")
    cat_values = []
    for i, name in enumerate(category_names):
        cat_values.append([sql_str("Xkc%02d" % (i + 1)), sql_str(WS_ID), sql_str(cut(name, 12)),
                           sql_str(CATEGORY_COLORS[i % len(CATEGORY_COLORS)]), str(i),
                           sql_dt(datetime(2026, 6, 1, 9, 0))])
    insert("category", ["id", "workspace_id", "name", "color", "sort_order", "created_at"], cat_values)

    insert("workspace_priority",
           ["id", "workspace_id", "code", "name", "color", "created_at"],
           [[sql_str("Xkwp%02d" % (i + 1)), sql_str(WS_ID), sql_str(code), sql_str(label), sql_str(color),
             sql_dt(datetime(2026, 6, 1, 9, 0))]
            for i, (code, label, color) in enumerate([
                ("P0", "最高", "#cf1322"), ("P1", "高", "#d48806"),
                ("P2", "中", "#3370ff"), ("P3", "低", "#8c8c8c")])])

    tag_names = []
    for name in list(module_project.keys()) + ["线上问题", "体验优化"]:
        if name and name not in tag_names:
            tag_names.append(cut(name, 16))
    tag_values = []
    for i, name in enumerate(tag_names):
        tag_values.append([sql_str("Xktg%02d" % (i + 1)), sql_str(WS_ID), sql_str(name),
                           sql_dt(datetime(2026, 6, 1, 9, 0))])
    insert("tag", ["id", "workspace_id", "name", "created_at"], tag_values)
    tag_id_by_name = {name: "Xktg%02d" % (i + 1) for i, name in enumerate(tag_names)}

    # 项目
    req_values = []
    for name in project_names:
        p = next(x for x in projects if x["name"] == name)
        proj_tasks = [t for t in tasks if t["project"] == name]
        starts = [t["start"] for t in proj_tasks if t["start"]]
        ends = [t["due"] for t in proj_tasks if t["due"]]
        planned_start = min(starts) if starts else date(2026, 6, 1)
        planned_end = max(ends) if ends else date(2026, 12, 31)
        first_release = None
        if p["status"] == "done":
            first_release = max((t["completed"] for t in proj_tasks if t["completed"]), default=None)
            first_release = first_release or date(2026, 8, 19)
        elif name == "流程引擎" and release_list:
            first_release = release_list[0]["date"]
        req_values.append([
            sql_str(project_ids[name]), sql_str(WS_ID), sql_str(name),
            sql_str(cut(p["objective"], 160)), sql_str(p["objective"]), sql_str(p["status"]),
            sql_str(USER_ID.get(PROJECT_LEAD.get(name, "施亚彬"), USER_ID["施亚彬"])),
            sql_date(planned_start), sql_date(planned_end), sql_date(first_release),
            sql_dt(datetime(2026, 6, 1, 9, 0)), sql_dt(now),
        ])
    insert("requirement",
           ["id", "workspace_id", "name", "description", "objective", "status",
            "owner_user_id", "planned_start", "planned_end", "first_released_at",
            "created_at", "updated_at"], req_values)

    # 需求文档（按模块分组，文档多的项目创建模块目录）
    doc_values = []
    doc_sort = Counter()
    # 按项目+模块分组
    proj_mod_docs = defaultdict(lambda: defaultdict(list))
    for doc in docs:
        mod = doc["module"] or "其他"
        proj_mod_docs[doc["project"]][mod].append(doc)
    # 为文档数超过 3 的项目创建模块目录文档
    folder_id_map = {}  # (project, module) -> folder_doc_id
    folder_counter = 0
    for proj in sorted(proj_mod_docs.keys()):
        total = sum(len(ds) for ds in proj_mod_docs[proj].values())
        if total <= 3:
            continue
        for mod in sorted(proj_mod_docs[proj].keys()):
            if len(proj_mod_docs[proj][mod]) < 2:
                continue
            folder_counter += 1
            fid = "Xkdf%04d" % folder_counter
            folder_id_map[(proj, mod)] = fid
            mod_docs = proj_mod_docs[proj][mod]
            brief = "%s（%d 篇文档）" % (mod, len(mod_docs))
            fcontent = "<p>%s相关需求文档，共 %d 篇。</p>" % (mod, len(mod_docs))
            doc_values.append([
                sql_str(fid), sql_str(WS_ID), sql_str(project_ids[proj]),
                "NULL", sql_str(mod), "'other'", sql_str(fcontent), "'html'",
                sql_str(brief), "'active'", "NULL", "0",
                sql_str("施亚彬"), sql_str(USER_ID["施亚彬"]),
                sql_dt(datetime(2026, 6, 1, 9, 0)), sql_dt(datetime(2026, 6, 1, 9, 0)),
            ])
    # 具体文档挂到模块目录下
    for doc in docs:
        content = ("<h2>背景</h2><p>%s</p><h2>需求范围</h2><ul><li>%s</li></ul>"
                   "<h2>验收标准</h2><ol><li>功能按需求描述可用</li><li>关键路径回归通过</li></ol>"
                   % (html.escape(doc["description"]), html.escape(doc["title"])))
        sort_no = doc_sort[doc["project"]]
        doc_sort[doc["project"]] += 1
        mod = doc["module"] or "其他"
        parent = sql_str(folder_id_map[(doc["project"], mod)]) if (doc["project"], mod) in folder_id_map else "NULL"
        doc_values.append([
            sql_str(doc["id"]), sql_str(WS_ID), sql_str(project_ids[doc["project"]]),
            parent, sql_str(doc["title"]), "'requirement'", sql_str(content), "'html'",
            sql_str(cut(doc["description"], 400)), sql_str(doc["status"]),
            sql_dt(dt(doc["published"], 18, 0)) if doc["published"] else "NULL",
            str(sort_no),
            sql_str(doc["owner"]), sql_str(USER_ID.get(doc["owner"], USER_ID["施亚彬"])),
            sql_dt(dt(doc["created"], 9, 30)),
            sql_dt(dt(doc["published"], 18, 0) if doc["published"] else dt(doc["created"], 9, 30)),
        ])
    insert("requirement_doc",
           ["id", "workspace_id", "req_id", "parent_id", "title", "doc_type", "content", "format",
            "content_brief", "status", "published_at", "sort_order", "owner", "owner_user_id",
            "created_at", "updated_at"], doc_values)

    # 需求池
    demand_values = []
    demand_logs = []
    for dem in demand_rows:
        demand_values.append([
            sql_str(dem["id"]), sql_str(WS_ID), sql_str(project_ids[dem["project"]]),
            sql_str(dem["title"]), sql_str(dem["description"]), sql_str(dem["source"]),
            sql_str(dem["kind"]), sql_str(dem["priority"]), sql_str(dem["status"]),
            sql_date(dem["expect"]), sql_str("功能按需求描述可用；关键路径回归通过；无阻断级缺陷。"),
            sql_str(dem["version"]), sql_str(dem["note"]),
            str(dem["biz"]), str(dem["urgent"]), str(dem["risk"]), str(dem["effort"]),
            sql_str(USER_ID.get(dem["doc"]["proposer"] or dem["doc"]["owner"], USER_ID["施亚彬"])),
            sql_dt(dt(dem["created"], 10, 0)), sql_dt(dt(dem["created"], 10, 0)),
        ])
        action = {"review": "create", "pass": "pass", "plan": "plan", "rej": "rej"}[dem["status"]]
        demand_logs.append([sql_str(WS_ID), sql_str(dem["id"]), "'create'", sql_str("需求进入需求池"),
                            sql_str(USER_ID.get(dem["doc"]["proposer"] or dem["doc"]["owner"], USER_ID["施亚彬"])),
                            sql_dt(dt(dem["created"], 10, 0))])
        if action != "create":
            demand_logs.append([sql_str(WS_ID), sql_str(dem["id"]), sql_str(action), sql_str(dem["note"]),
                                sql_str(USER_ID["张伟"]), sql_dt(dt(add_days(dem["created"], 2), 15, 0))])
    insert("demand",
           ["id", "workspace_id", "req_id", "title", "description", "source", "item_kind",
            "priority", "status", "expect_date", "accept_text", "version_id", "review_note",
            "wsjf_business", "wsjf_urgency", "wsjf_risk", "wsjf_effort", "created_by",
            "created_at", "updated_at"], demand_values)
    insert("demand_log", ["workspace_id", "demand_id", "action", "note", "operator", "created_at"],
           demand_logs)
    demand_doc_links = []
    for dem in demand_rows:
        demand_doc_links.append([sql_str(WS_ID), sql_str(dem["id"]), sql_str(dem["doc"]["id"]),
                                 sql_str(USER_ID["张伟"]), sql_dt(dt(dem["created"], 10, 0))])
    insert("demand_doc_link", ["workspace_id", "demand_id", "doc_id", "created_by", "created_at"],
           demand_doc_links)

    # 版本
    version_values = []
    for v in versions:
        version_values.append([
            sql_str(v["id"]), sql_str(WS_ID), sql_str(project_ids[v["project"]]), sql_str(v["name"]),
            sql_str(v["description"]), sql_str(v["status"]), sql_date(v["start"]), sql_date(v["target"]),
            sql_dt(dt(v["released"], 18, 0)) if v["released"] else "NULL",
            sql_dt(datetime(2026, 6, 1, 9, 0)), sql_dt(now),
        ])
    insert("project_version",
           ["id", "workspace_id", "req_id", "name", "description", "status", "start_date",
            "target_date", "released_at", "created_at", "updated_at"], version_values)
    insert("version_task", ["task_id", "workspace_id", "version_id", "created_at"],
           [[sql_str(tid), sql_str(WS_ID), sql_str(vid),
             sql_dt(dt(version_by_id[vid]["released"], 19, 0) if version_by_id[vid]["released"] else now)]
            for tid, vid in version_tasks])

    # 项目成员
    pm_values = []
    for project, mapping in members.items():
        for name, access in mapping.items():
            if name not in USER_ID:
                continue
            pm_values.append([sql_str(WS_ID), sql_str(project_ids[project]), sql_str(USER_ID[name]),
                              sql_str(access), sql_dt(datetime(2026, 6, 1, 9, 0)), sql_dt(now)])
    insert("project_member",
           ["workspace_id", "project_id", "user_id", "access", "created_at", "updated_at"], pm_values)

    # 分支（无任务的项目不生成分支）
    projects_with_tasks = set(t["project"] for t in tasks)
    branch_values = []
    branch_logs = []
    for name in project_names:
        if name not in projects_with_tasks:
            continue
        p = next(x for x in projects if x["name"] == name)
        lead = PROJECT_LEAD.get(name, "施亚彬")
        status = "released" if p["status"] == "done" else ("testing" if name == "流程引擎" else "dev")
        start = min((t["start"] for t in tasks if t["project"] == name and t["start"]), default=date(2026, 6, 1))
        dev_at = dt(start, 10, 0)
        test_at = dt(add_days(start, 30), 10, 0)
        merge_at = dt(add_days(start, 40), 10, 0)
        released_at = None
        if status == "released":
            released_at = dt(add_days(start, 50), 18, 0)
        branch_values.append([
            sql_str(branch_ids[name]), sql_str(WS_ID), sql_str(project_ids[name]),
            sql_str("feature/" + PROJECT_SLUG.get(name, "project")), sql_str(status), sql_str(lead),
            sql_str(USER_ID.get(lead, USER_ID["施亚彬"])), "'main'", sql_str("对应项目主开发分支"),
            sql_dt(dev_at), sql_dt(test_at) if status in ("testing", "merging", "released") else "NULL",
            sql_dt(merge_at) if status in ("merging", "released") else "NULL",
            sql_dt(released_at) if released_at else "NULL", "0",
            sql_dt(dev_at), sql_dt(released_at or test_at),
        ])
        def blog(action, frm, to, detail, at):
            branch_logs.append([sql_str("Xkbl%04d" % (len(branch_logs) + 1)), sql_str(WS_ID),
                                sql_str(branch_ids[name]), sql_str(action), frm, to,
                                sql_str(detail), sql_str(lead),
                                sql_str(USER_ID.get(lead, USER_ID["施亚彬"])), sql_dt(at)])
        blog("create", "NULL", "'dev'", "创建开发分支", dev_at)
        if status in ("testing", "merging", "released"):
            blog("status", "'dev'", "'testing'", "开发完成，转入测试", test_at)
        if status in ("merging", "released"):
            blog("status", "'testing'", "'merging'", "测试通过，等待合并", merge_at)
        if status == "released":
            blog("status", "'merging'", "'released'", "合并主干并发布", released_at)
    insert("dev_branch",
           ["id", "workspace_id", "req_id", "name", "status", "owner", "owner_user_id",
            "target_branch", "note", "dev_at", "test_at", "merge_at", "released_at", "sort_order",
            "created_at", "updated_at"], branch_values)
    insert("dev_branch_log",
           ["id", "workspace_id", "branch_id", "action", "from_status", "to_status", "detail",
            "actor_name", "actor_user_id", "created_at"], branch_logs)

    # 任务
    task_values = []
    for task in tasks:
        extra = task["extra"]
        task_values.append([
            sql_str(task["id"]), sql_str(WS_ID), sql_str(task["title"]), sql_str(task["description"]),
            sql_str(task["item_type"]), "NULL",
            sql_str(task["demand"]) if task["demand"] else "NULL",
            sql_str(extra.get("severity")) if task["item_type"] == "bug" else "NULL",
            sql_str(extra.get("environment")) if task["item_type"] == "bug" else "NULL",
            sql_str(extra.get("steps")) if task["item_type"] == "bug" else "NULL",
            sql_str(extra.get("found")) if task["item_type"] == "bug" else "NULL",
            sql_str(extra.get("regression")) if task["item_type"] == "bug" else "NULL",
            sql_str(task["priority"]), sql_str(task["owner"]),
            sql_str(USER_ID.get(task["owner"], USER_ID["施亚彬"])),
            sql_str(task["module"] if task["module"] in category_names else "其他"),
            sql_str(task["column"]), sql_date(task["start"]), sql_date(task["due"]),
            sql_str(project_ids[task["project"]]),
            sql_str(task["doc"]["id"]) if task["doc"] else "NULL",
            sql_str(task["branch"]), str(task["progress"]), "0", sql_num(task["estimate"]),
            "0", "NULL", "NULL",
            sql_str(cut("历史状态：" + task["status_raw"]
                        + ("；源表完成时间：" + str(task.get("completed_raw"))
                           if task["column"] != "done" and task.get("completed_raw") else ""), 200))
            if task["status_raw"] else "NULL",
            sql_date(task["completed"]), "NULL", "NULL", "NULL", "'owner'", "0", "NULL",
            str(task["sort"]), sql_dt(task["created"]),
            sql_dt(dt(task["completed"], 18, 0) if task["completed"] else
                   (dt(task["due"], 18, 0) if task["due"] else task["created"])),
        ])
    insert("task",
           ["id", "workspace_id", "title", "description", "item_type", "epic_id", "demand_id",
            "severity", "environment", "reproduce_steps", "found_version_id", "regression_status",
            "priority", "owner", "owner_user_id", "category", "board_column", "start_date", "due_date",
            "req_id", "req_doc_id", "branch_id", "progress", "is_milestone", "estimate_minutes",
            "is_blocked", "blocked_reason", "blocked_by_task_id", "note", "completed_at",
            "recur_type", "recur_next_id", "remind_at", "remind_target", "remind_sent",
            "deleted_at", "sort_order", "created_at", "updated_at"], task_values)

    # 标签
    task_tags = []
    for task in tasks:
        tag_name = task["module"] if task["module"] in tag_id_by_name else None
        if tag_name:
            task_tags.append([sql_str(task["id"]), sql_str(tag_id_by_name[tag_name]), sql_str(WS_ID)])
        if task["item_type"] == "bug" and "线上问题" in tag_id_by_name:
            task_tags.append([sql_str(task["id"]), sql_str(tag_id_by_name["线上问题"]), sql_str(WS_ID)])
    insert("task_tag", ["task_id", "tag_id", "workspace_id"], task_tags)

    # 子任务 / 评论 / 关注
    subtasks = []
    comments = []
    watches = []
    for idx, task in enumerate(tasks):
        done = task["column"] == "done"
        labels = ["复现与定位", "修复验证"] if task["item_type"] == "bug" else ["开发实现", "自测验证"]
        for j, label in enumerate(labels):
            subtasks.append([sql_str(task["id"]), sql_str(WS_ID), sql_str(label),
                             "1" if (done or j == 0) else "0",
                             sql_dt(task["created"]), sql_dt(task["created"])])
        if idx % 7 == 0:
            author = task["owner"] if idx % 2 == 0 else PROJECT_LEAD.get(task["project"], "施亚彬")
            content = ("缺陷已复现并定位，等待修复验证。" if task["item_type"] == "bug"
                       else "已完成自测，等待提测。" if not done else "已上线，回归通过。")
            comments.append([sql_str(task["id"]), sql_str(WS_ID), sql_str(USER_ID.get(author, USER_ID["施亚彬"])),
                             sql_str(author), sql_str(content),
                             sql_dt(dt(task["completed"] or task["due"] or TODAY, 16, 0))])
    insert("subtask", ["task_id", "workspace_id", "title", "done", "created_at", "updated_at"], subtasks)
    insert("task_comment", ["task_id", "workspace_id", "author_id", "author_name", "content", "created_at"],
           comments)

    # 任务动态
    task_logs = []
    for task in tasks:
        task_logs.append([sql_str(task["id"]), sql_str(WS_ID),
                          sql_str(USER_ID.get(task["owner"], USER_ID["施亚彬"])),
                          "'create'", sql_str("创建任务：" + task["title"]),
                          "NULL", "NULL", sql_dt(task["created"])])
        if task["column"] == "done":
            from_col = "backlog" if task["status_raw"] in ("未启动", "") else "doing"
            task_logs.append([sql_str(task["id"]), sql_str(WS_ID),
                              sql_str(USER_ID.get(task["owner"], USER_ID["施亚彬"])),
                              "'move'", sql_str("状态变更：" + (task["status_raw"] or "未启动")),
                              sql_str(from_col), "'done'",
                              sql_dt(dt(task["completed"], 18, 0) if task["completed"] else task["created"])])
    insert("task_log", ["task_id", "workspace_id", "actor_id", "action", "detail",
                        "from_column", "to_column", "created_at"], task_logs)

    # 工时与完成记录
    time_values = []
    for task_id, owner, begin, finish, minutes in time_logs:
        time_values.append([sql_str(task_id), sql_str(WS_ID), sql_str(USER_ID.get(owner, USER_ID["施亚彬"])),
                            sql_dt(begin), sql_dt(finish), str(minutes), "'manual'",
                            sql_str("历史任务补记（按任务起止日期合成）")])
    insert("time_log", ["task_id", "workspace_id", "user_id", "started_at", "ended_at",
                        "minutes", "origin", "note"], time_values)

    completion_values = []
    for rec in completions:
        task = rec["task"]
        owner = task["owner"]
        completion_values.append([
            sql_str(WS_ID), sql_str(task["id"]), sql_str(task["title"]), sql_str(task["description"]),
            sql_str(project_ids[task["project"]]),
            sql_str(next(p["name"] for p in projects if p["name"] == task["project"])),
            sql_str(task["doc"]["id"]) if task["doc"] else "NULL",
            sql_str(task["doc"]["title"]) if task["doc"] else "NULL",
            sql_str(owner), sql_str(USER_ID.get(owner, USER_ID["施亚彬"])),
            sql_str(task["module"] if task["module"] in category_names else "其他"),
            sql_str(task["priority"]), sql_date(rec["start"]), sql_date(rec["end"]),
            sql_dt(rec["first"]), sql_dt(rec["last"]), str(rec["minutes"]),
            sql_dt(dt(rec["end"], 18, 0)),
        ])
    insert("task_completion_record",
           ["workspace_id", "task_id", "title", "description", "req_id", "req_name",
            "req_doc_id", "req_doc_title", "owner", "owner_user_id", "category", "priority",
            "start_date", "completed_at", "first_started_at", "last_ended_at", "total_minutes",
            "created_at"], completion_values)

    # 测试模块 / 用例 / 执行 / 计划
    insert("test_module", ["id", "workspace_id", "req_id", "name", "sort_order", "created_at"],
           [[sql_str(tm["id"]), sql_str(WS_ID), sql_str(project_ids[tm["project"]]), sql_str(tm["name"]),
             str(tm["sort"]), sql_dt(datetime(2026, 6, 1, 9, 0))]
            for tm in test_modules.values()])

    case_values = []
    for case in cases:
        steps = json.dumps([{"action": "按需求执行核心业务流程", "expected": "结果符合需求描述"}],
                           ensure_ascii=False)
        case_values.append([
            sql_str(case["id"]), sql_str(WS_ID), sql_str(project_ids[case["project"]]),
            sql_str(demand_by_doc.get(id(case["doc"]))), sql_str(case["title"]), sql_str(case["precondition"]),
            sql_str(cut(case["module"], 50)), sql_str(case["priority"]), sql_str(steps),
            sql_str(case["latest"]), sql_str(case["note"]), sql_str(case["latest_by"]),
            sql_str(USER_ID.get(case["latest_by"], USER_ID["施亚彬"])) if case["latest_by"] else "NULL",
            sql_dt(case["latest_at"]), sql_str(case["bug"]),
            sql_dt(datetime(2026, 6, 1, 9, 0)), sql_dt(now),
        ])
    insert("test_case",
           ["id", "workspace_id", "req_id", "demand_id", "title", "precondition", "module",
            "priority", "steps", "latest_status", "latest_note", "latest_by", "latest_by_user_id",
            "latest_at", "latest_bug_task_id", "created_at", "updated_at"], case_values)

    run_values = []
    for case in cases:
        if not case["latest"]:
            continue
        plan = next((p for p in plans if p["project"] == case["project"]), None)
        run_values.append([
            sql_str("Xktr%04d" % len(run_values)), sql_str(case["id"]), sql_str(WS_ID),
            sql_str(case["latest"]), sql_str(case["note"]), sql_str(case["bug"]),
            sql_str(plan["id"]) if plan else "NULL",
            sql_str(case["latest_by"]), sql_str(USER_ID.get(case["latest_by"], USER_ID["施亚彬"])),
            sql_dt(case["latest_at"]),
        ])
    insert("test_case_run",
           ["id", "case_id", "workspace_id", "status", "note", "bug_task_id", "plan_id",
            "executed_by", "executed_by_user_id", "created_at"], run_values)

    plan_values = []
    for plan in plans:
        plan_values.append([
            sql_str(plan["id"]), sql_str(WS_ID), sql_str(project_ids[plan["project"]]),
            sql_str(plan["name"]), sql_str(plan["version"]), sql_date(plan["start"]),
            sql_date(plan["end"]), sql_str(plan["status"]), sql_str("运营研发回归测试"),
            sql_str(plan["owner"]), sql_str(USER_ID.get(plan["owner"], USER_ID["施亚彬"])),
            sql_dt(dt(plan["start"], 9, 0)), sql_dt(dt(plan["end"], 18, 0)),
        ])
    insert("test_plan",
           ["id", "workspace_id", "req_id", "name", "version_id", "planned_start", "planned_end",
            "status", "note", "created_by", "created_by_user_id", "created_at", "updated_at"],
           plan_values)

    insert("test_plan_case",
           ["id", "plan_id", "case_id", "result", "note", "executed_by", "executed_by_user_id",
            "executed_at", "created_at"],
           [[sql_str(pc["id"]), sql_str(pc["plan"]), sql_str(pc["case"]), sql_str(pc["result"]),
             sql_str(pc["note"]), sql_str(pc["by"]),
             sql_str(USER_ID.get(pc["by"], USER_ID["施亚彬"])) if pc["by"] else "NULL",
             sql_dt(pc["at"]), sql_dt(pc["at"])] for pc in plan_cases if pc["result"]])

    # 文档历史 / 项目动态 / 审计
    history_values = []
    for doc in docs:
        history_values.append([
            sql_str("Xkdh%04d" % len(history_values)), sql_str(doc["id"]), sql_str(WS_ID), "1",
            sql_str(doc["title"]),
            sql_str("<p>%s</p>" % html.escape(doc["description"])), "'html'",
            sql_str(doc["owner"]), sql_str(USER_ID.get(doc["owner"], USER_ID["施亚彬"])),
            sql_dt(dt(doc["created"], 9, 40)),
        ])
        if doc["status"] == "done":
            history_values.append([
                sql_str("Xkdh%04d" % len(history_values)), sql_str(doc["id"]), sql_str(WS_ID), "2",
                sql_str(doc["title"]),
                sql_str("<p>%s</p>" % html.escape(doc["description"])), "'html'",
                sql_str(doc["owner"]), sql_str(USER_ID.get(doc["owner"], USER_ID["施亚彬"])),
                sql_dt(dt(doc["published"], 18, 0)),
            ])
    insert("requirement_doc_history",
           ["id", "doc_id", "workspace_id", "version_no", "title", "content", "format",
            "saved_by", "saved_by_user_id", "created_at"], history_values)

    activity_values = []
    audit_values = []
    for name in project_names:
        p = next(x for x in projects if x["name"] == name)
        lead = PROJECT_LEAD.get(name, "施亚彬")
        at = dt(datetime(2026, 6, 1, 9, 0).date(), 9, 0)
        activity_values.append([sql_str(WS_ID), "'project'", sql_str(project_ids[name]),
                                sql_str(USER_ID.get(lead, USER_ID["施亚彬"])), sql_str(lead),
                                "'create'", sql_str("创建项目：" + name), sql_dt(at)])
        audit_values.append([sql_str(WS_ID), sql_str(USER_ID.get(lead, USER_ID["施亚彬"])), sql_str(lead),
                             "'create'", "'project'", sql_str(project_ids[name]), sql_str(name),
                             "'success'", sql_str("创建项目：" + name), sql_dt(at)])
        if p["status"] == "done":
            rel_at = dt(date(2026, 8, 19), 18, 0)
            activity_values.append([sql_str(WS_ID), "'project'", sql_str(project_ids[name]),
                                    sql_str(USER_ID.get(lead, USER_ID["施亚彬"])), sql_str(lead),
                                    "'first_release'", sql_str("项目首版上线"), sql_dt(rel_at)])
            audit_values.append([sql_str(WS_ID), sql_str(USER_ID.get(lead, USER_ID["施亚彬"])), sql_str(lead),
                                 "'first_release'", "'project'", sql_str(project_ids[name]), sql_str(name),
                                 "'success'", sql_str("项目首版上线"), sql_dt(rel_at)])
    for doc in docs:
        if doc["status"] != "done":
            continue
        lead = PROJECT_LEAD.get(doc["project"], "施亚彬")
        at = dt(doc["published"], 18, 0)
        activity_values.append([sql_str(WS_ID), "'requirement_doc'", sql_str(doc["id"]),
                                sql_str(USER_ID.get(lead, USER_ID["施亚彬"])), sql_str(lead),
                                "'first_release'", sql_str("需求随版本发布：" + doc["title"]), sql_dt(at)])
        audit_values.append([sql_str(WS_ID), sql_str(USER_ID.get(lead, USER_ID["施亚彬"])), sql_str(lead),
                             "'first_release'", "'requirement_doc'", sql_str(doc["id"]), sql_str(doc["title"]),
                             "'success'", sql_str("需求随版本发布"), sql_dt(at)])
    insert("work_activity",
           ["workspace_id", "entity_type", "entity_id", "actor_id", "actor_name", "action",
            "detail", "created_at"], activity_values)
    insert("audit_log",
           ["workspace_id", "actor_id", "actor_name", "action", "target_type", "target_id",
            "target_name", "result", "detail", "created_at"], audit_values)

    emit("COMMIT;")
    emit("SET FOREIGN_KEY_CHECKS = 1;")
    emit("")
    emit("-- 数据统计（导入后可执行校验）")
    emit("-- 用户 %d / 项目 %d / 需求文档 %d（含 %d 个模块目录）/ 任务 %d / 需求池 %d / 版本 %d / 用例 %d / 执行 %d / 工时 %d"
         % (len(user_values), len(project_names), len(docs) + folder_counter, folder_counter, len(tasks), len(demand_rows),
            len(versions), len(cases), len(run_values), len(time_logs)))

    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out))

    print("已生成 %s" % args.out)
    print("用户 %d / 项目 %d / 需求文档 %d（含 %d 个模块目录）/ 任务 %d / 需求池 %d / 版本 %d / 用例 %d / 执行 %d / 工时 %d"
          % (len(user_values), len(project_names), len(docs) + folder_counter, folder_counter, len(tasks), len(demand_rows),
             len(versions), len(cases), len(run_values), len(time_logs)))


def sum_num(value):
    s = norm_text(value)
    if not s:
        return 0
    try:
        return float(s)
    except ValueError:
        return 0


if __name__ == "__main__":
    build()
