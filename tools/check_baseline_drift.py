#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
基线 SQL 漂移校验（报告 14.1 / A1）

原理：sql/baseline/01_schema_full.sql 必须包含 sql/NN_*.sql 全部增量的最终结果。
空库只放基线时，HEAD 代码依赖的表/列/索引/类型若缺失或过期，就会在首次请求报错
——本脚本在 CI/发布前拦截这类漂移。

校验口径（按编号顺序模拟执行全部增量，对每张最终仍存在的表）：
  - 增量里的 CREATE TABLE t            → 基线必须存在表 t
  - 增量里的 ALTER TABLE t ADD COLUMN c → 基线表 t 必须有列 c
  - 增量里的 ADD KEY / ADD INDEX k      → 基线表 t 必须有索引 k
  - 增量里的 MODIFY / CHANGE COLUMN 类型 → 基线列类型必须与增量最终类型一致
    （比较归一化为小写、去空格、忽略整数显示宽度；tinyint(1) 保留）
  - 增量里建完又 DROP TABLE 的临时表（如迁移映射表）不要求进基线
  - 后续被 DROP COLUMN / CHANGE COLUMN 改名掉的列不再校验
范围：sql/ 根目录的全部编号增量（早期 01_schema.sql 已归档到 sql/legacy/，不参与），
按文件名数字前缀升序执行；无编号前缀的文件不参与。

用法：python3 tools/check_baseline_drift.py [仓库根目录]
退出码：0=无漂移；1=发现漂移（输出缺失明细）。
"""
import re
import sys
import os

# 增量里的列定义可能带/不带反引号；类型必须来自白名单，避免把 AFTER 之类的关键字当类型。
# 类型白名单必须长者在前（datetime 先于 date、mediumtext 先于 text、bigint 先于 int），
# 正则择先匹配，顺序错了会把 datetime 截成 date。
SQL_TYPES = (r"(?:tinyint|smallint|mediumint|bigint|integer|int|decimal|numeric|"
             r"float|double|real|bit|boolean|bool|datetime|timestamp|date|time|year|"
             r"varchar|varbinary|binary|char|mediumtext|longtext|tinytext|text|"
             r"mediumblob|longblob|tinyblob|blob|json|enum|set)")
TYPE_DEF = SQL_TYPES + r"(?:\s*\([^)]*\))?(?:\s+unsigned)?"
TYPE_RE = re.compile(SQL_TYPES + r"(\s*\([^)]*\))?(\s+unsigned)?", re.I)
INT_WIDTH_TYPES = {"tinyint", "smallint", "mediumint", "int", "integer", "bigint"}


def strip_sql_comments(sql):
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)


def norm_type(raw):
    """列类型归一化：小写、去空格、忽略整数显示宽度（tinyint(1) 保留布尔语义）。"""
    if not raw:
        return None
    m = TYPE_RE.match(raw.strip())
    if not m:
        return None
    base = re.match(SQL_TYPES, m.group(0), re.I).group(0).lower()
    args = (m.group(1) or "").replace(" ", "")
    unsigned = "unsigned" if m.group(2) else ""
    if base in INT_WIDTH_TYPES and args.startswith("(") and args.endswith(")"):
        if not (base == "tinyint" and args == "(1)"):
            args = ""
    return base + args + unsigned


def parse_baseline(path):
    sql = open(path, encoding="utf-8").read()
    tables = {}  # table -> {"cols": set, "types": dict, "keys": set}
    for m in re.finditer(
            r"CREATE TABLE\s+`(\w+)`\s*\((.*?)\)\s*ENGINE", sql, re.S | re.I):
        name, body = m.group(1), m.group(2)
        cols, types, keys = set(), {}, set()
        for line in body.splitlines():
            line = line.strip()
            cm = re.match(r"`(\w+)`\s+(.+)$", line)
            if cm:
                cols.add(cm.group(1))
                types[cm.group(1)] = norm_type(cm.group(2))
                continue
            km = re.match(r"(?:UNIQUE\s+)?KEY\s+`(\w+)`", line)
            if km:
                keys.add(km.group(1))
            if re.match(r"PRIMARY KEY", line):
                keys.add("PRIMARY")
        tables[name] = {"cols": cols, "types": types, "keys": keys}
    return tables

def parse_increments(sql_dir, skip):
    """返回 (items, types, dropped, dropped_tables)：
    items 为基线必须满足项 [(file, table, kind, name)]；
    types 为按执行顺序记录的列类型期望 {(table, col): (file, norm_type)}，后者覆盖前者；
    dropped 为后续增量已删除/改名的 (table, kind, name)；
    dropped_tables 为增量里最终被 DROP 且未再建的表（临时映射表等），不要求进基线。"""
    items = []
    types = {}
    dropped = set()
    dropped_tables = set()
    files = [fn for fn in os.listdir(sql_dir)
             if fn.endswith(".sql") and fn not in skip and re.match(r"\d+", fn)]
    # 必须按编号（而非字典序）执行，99 早于 100，后写覆盖前写的最终态才正确
    files.sort(key=lambda fn: int(re.match(r"\d+", fn).group()))
    for fn in files:
        sql = strip_sql_comments(open(os.path.join(sql_dir, fn), encoding="utf-8").read())
        # 按脚本内出现顺序模拟建表/删表：迁移里的临时映射表建完就删，最终不应进基线
        for m in re.finditer(
                r"CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`?(\w+)`?|"
                r"DROP TABLE(?:\s+IF EXISTS)?\s+`?(\w+)`?", sql, re.I):
            if m.group(1):
                items.append((fn, m.group(1), "table", m.group(1)))
                dropped_tables.discard(m.group(1))
            else:
                dropped_tables.add(m.group(2))
        for m in re.finditer(
                r"CALL\s+hg_delivery_column\(\s*'([^']+)'\s*,\s*'([^']+)'"
                r"(?:\s*,\s*'([^']*)')?", sql, re.I):
            table, col = m.group(1), m.group(2)
            items.append((fn, table, "column", col))
            if norm_type(m.group(3)):
                types[(table, col)] = (fn, norm_type(m.group(3)))
        # ALTER TABLE t ...;（语句体可能含多个 ADD/DROP COLUMN/KEY；幂等脚本写在 PREPARE 字符串里，同样能匹配）
        for m in re.finditer(r"ALTER TABLE\s+`?(\w+)`?([^;]*);", sql, re.I | re.S):
            table, body = m.group(1), m.group(2)
            for c in re.finditer(
                    r"ADD COLUMN(?:\s+IF NOT EXISTS)?\s+`?(\w+)`?\s*(" + TYPE_DEF + r")?",
                    body, re.I):
                items.append((fn, table, "column", c.group(1)))
                if norm_type(c.group(2)):
                    types[(table, c.group(1))] = (fn, norm_type(c.group(2)))
            for c in re.finditer(r"MODIFY COLUMN\s+`?(\w+)`?\s+(" + TYPE_DEF + r")", body, re.I):
                items.append((fn, table, "column", c.group(1)))
                types[(table, c.group(1))] = (fn, norm_type(c.group(2)))
            for c in re.finditer(r"CHANGE COLUMN\s+`?(\w+)`?\s+`?(\w+)`?\s+(" + TYPE_DEF + r")",
                                 body, re.I):
                dropped.add((table, "column", c.group(1)))
                items.append((fn, table, "column", c.group(2)))
                types[(table, c.group(2))] = (fn, norm_type(c.group(3)))
            for k in re.finditer(r"ADD (?:UNIQUE\s+)?(?:KEY|INDEX)\s+`?(\w+)`?", body, re.I):
                items.append((fn, table, "key", k.group(1)))
            if re.search(r"ADD\s+PRIMARY\s+KEY", body, re.I):
                items.append((fn, table, "key", "PRIMARY"))
            for c in re.finditer(r"DROP COLUMN\s+`?(\w+)`?", body, re.I):
                dropped.add((table, "column", c.group(1)))
            for k in re.finditer(r"DROP (?:KEY|INDEX)\s+`?(\w+)`?", body, re.I):
                dropped.add((table, "key", k.group(1)))
            if re.search(r"DROP\s+PRIMARY\s+KEY", body, re.I):
                dropped.add((table, "key", "PRIMARY"))
    return items, types, dropped, dropped_tables

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else \
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    baseline_path = os.path.join(root, "sql", "baseline", "01_schema_full.sql")
    sql_dir = os.path.join(root, "sql")
    if not os.path.exists(baseline_path):
        print("找不到基线文件：%s" % baseline_path)
        return 1

    tables = parse_baseline(baseline_path)
    items, types, dropped, dropped_tables = parse_increments(sql_dir, skip=set())
    missing = []
    for fn, table, kind, name in items:
        if (table, kind, name) in dropped:
            continue
        # 增量里最后被删掉的临时表：最终不存在，不要求基线保留（列/键同理）
        if table in dropped_tables:
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
    for (table, col), (fn, want) in types.items():
        if (table, "column", col) in dropped or table in dropped_tables:
            continue
        # 列缺失已由上面的 column 项报告，这里只比对类型，避免重复噪声
        if table not in tables or col not in tables[table]["cols"]:
            continue
        have = tables[table]["types"].get(col)
        if have and want and have != want:
            missing.append((fn, "表 %s 列 %s 类型为 %s，增量要求 %s" % (table, col, have, want)))
    if missing:
        print("基线漂移：sql/baseline/01_schema_full.sql 与增量最终态不一致（%d 项）：" % len(missing))
        for fn, msg in missing:
            print("  - [%s] %s" % (fn, msg))
        return 1
    print("基线校验通过：%d 个增量脚本的表/列/索引/类型均已收敛进 sql/baseline/01_schema_full.sql"
          % len({fn for fn, _t, _k, _n in items} | {fn for fn, _w in types.values()}))
    return 0

if __name__ == "__main__":
    sys.exit(main())
