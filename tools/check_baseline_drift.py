#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
基线 SQL 漂移校验（报告 14.1 / A1）

原理：sql/baseline/01_schema_full.sql 必须包含 sql/NN_*.sql 全部增量
（CREATE TABLE / ADD COLUMN / ADD KEY）的最终结果。空库只放基线时，
HEAD 代码依赖的列若缺失就会在首次请求报错——本脚本在 CI/发布前拦截这类漂移。

校验口径（对每张基线内已存在的表）：
  - 增量里的 CREATE TABLE t          → 基线必须存在表 t
  - 增量里的 ALTER TABLE t ADD COLUMN c → 基线表 t 必须有列 c
  - 增量里的 ALTER TABLE t ADD KEY k  → 基线表 t 必须有索引 k
范围：sql/02*.sql 起的全部增量（01_schema.sql 是早期版本，不参与）。

用法：python3 tools/check_baseline_drift.py [仓库根目录]
退出码：0=无漂移；1=发现漂移（输出缺失明细）。
"""
import re
import sys
import os

def parse_baseline(path):
    sql = open(path, encoding="utf-8").read()
    tables = {}  # table -> {"cols": set, "keys": set}
    for m in re.finditer(
            r"CREATE TABLE\s+`(\w+)`\s*\((.*?)\)\s*ENGINE", sql, re.S | re.I):
        name, body = m.group(1), m.group(2)
        cols, keys = set(), set()
        for line in body.splitlines():
            line = line.strip()
            cm = re.match(r"`(\w+)`\s+\w", line)
            if cm:
                cols.add(cm.group(1))
            km = re.match(r"(?:UNIQUE\s+)?KEY\s+`(\w+)`", line)
            if km:
                keys.add(km.group(1))
            if re.match(r"PRIMARY KEY", line):
                keys.add("PRIMARY")
        tables[name] = {"cols": cols, "keys": keys}
    return tables

def parse_increments(sql_dir, skip):
    """返回 (items, dropped)：
    items 为基线必须满足项 [(file, table, kind, name)]；
    dropped 为后续增量已删除的 (table, kind, name) —— 列/索引被改名或移除后，
    早期增量的 ADD 不再要求基线保留（61 号脚本把 demand.category 改成 category_id 即此情形）。"""
    items = []
    dropped = set()
    for fn in sorted(os.listdir(sql_dir)):
        if not fn.endswith(".sql") or fn in skip or not re.match(r"\d+", fn):
            continue
        sql = open(os.path.join(sql_dir, fn), encoding="utf-8").read()
        for m in re.finditer(r"CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`(\w+)`", sql, re.I):
            items.append((fn, m.group(1), "table", m.group(1)))
        # ALTER TABLE t ... ;（语句体可能含多个 ADD/DROP COLUMN/KEY；61 起幂等脚本写在 PREPARE 字符串里，同样能匹配）
        for m in re.finditer(r"ALTER TABLE\s+`?(\w+)`?([^;]*);", sql, re.I | re.S):
            table, body = m.group(1), m.group(2)
            for c in re.finditer(r"ADD COLUMN\s+`(\w+)`", body, re.I):
                items.append((fn, table, "column", c.group(1)))
            for k in re.finditer(r"ADD (?:UNIQUE\s+)?KEY\s+`(\w+)`", body, re.I):
                items.append((fn, table, "key", k.group(1)))
            for c in re.finditer(r"DROP COLUMN\s+`(\w+)`", body, re.I):
                dropped.add((table, "column", c.group(1)))
            for k in re.finditer(r"DROP KEY\s+`(\w+)`", body, re.I):
                dropped.add((table, "key", k.group(1)))
    return items, dropped

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else \
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    baseline_path = os.path.join(root, "sql", "baseline", "01_schema_full.sql")
    sql_dir = os.path.join(root, "sql")
    if not os.path.exists(baseline_path):
        print("找不到基线文件：%s" % baseline_path)
        return 1

    tables = parse_baseline(baseline_path)
    items, dropped = parse_increments(sql_dir, skip={"01_schema.sql", "01_schema_full.sql"})
    missing = []
    for fn, table, kind, name in items:
        if (table, kind, name) in dropped:
            continue
        if kind == "table":
            if table not in tables:
                missing.append((fn, "表 %s 未进入基线" % table))
        elif kind == "column":
            if table in tables and name not in tables[table]["cols"]:
                missing.append((fn, "表 %s 缺列 %s" % (table, name)))
        elif kind == "key":
            if table in tables and name not in tables[table]["keys"]:
                missing.append((fn, "表 %s 缺索引 %s" % (table, name)))
        # 增量里表整体不存在（历史基线未含该表）时跳过列/键校验：
        # CREATE TABLE 项已覆盖"表缺失"这一更根本的漂移
    if missing:
        print("基线漂移：sql/baseline/01_schema_full.sql 缺少以下增量结果（%d 项）：" % len(missing))
        for fn, msg in missing:
            print("  - [%s] %s" % (fn, msg))
        return 1
    print("基线校验通过：%d 个增量脚本的表/列/索引均已收敛进 sql/baseline/01_schema_full.sql"
          % len({i[0] for i in items}))
    return 0

if __name__ == "__main__":
    sys.exit(main())
