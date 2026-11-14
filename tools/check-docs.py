#!/usr/bin/env python3
"""文档一致性检查：副本同步、Markdown 本地链接、表数量口径。

用法：python3 tools/check-docs.py
退出码非 0 表示存在需要修复的漂移。
"""

import os
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
FRONTEND = os.path.join(ROOT, "frontend")
BASELINE = os.path.join(ROOT, "sql", "baseline", "01_schema_full.sql")

# 前端帮助中心使用 user-guide.md 作为手册文件名，其余内容应与 docs 副本一致。
COPY_PAIRS = [
    ("管理员指南.md", "管理员指南.md"),
    ("项目介绍.md", "项目介绍.md"),
    ("项目起源.md", "项目起源.md"),
    ("常见问题.md", "常见问题.md"),
    ("快速上手指南.md", "快速上手指南.md"),
    ("产品说明.md", "产品说明.md"),
    # 帮助中心加载的是 user-guide.md；frontend/用户使用手册.md 是另一份被相对链接引用的副本。
    ("用户使用手册.md", "user-guide.md"),
    ("用户使用手册.md", "用户使用手册.md"),
]

LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def normalize(text):
    return text.replace("](用户使用手册.md)", "](user-guide.md)")


def check_copies(issues):
    for doc_name, front_name in COPY_PAIRS:
        a = os.path.join(DOCS, doc_name)
        b = os.path.join(FRONTEND, front_name)
        if not os.path.exists(a) or not os.path.exists(b):
            issues.append("缺少文档副本：%s / %s" % (doc_name, front_name))
            continue
        if normalize(read(a)) != normalize(read(b)):
            issues.append("文档副本不同步：docs/%s ↔ frontend/%s（先改 docs，再同步）" % (doc_name, front_name))


def check_links(issues):
    for folder in (DOCS, FRONTEND):
        for root, _dirs, files in os.walk(folder):
            for name in sorted(files):
                if not name.endswith(".md"):
                    continue
                path = os.path.join(root, name)
                rel_path = os.path.relpath(path, ROOT)
                text = read(path)
                for raw in LINK_RE.findall(text):
                    target = raw.strip()
                    if target.startswith(("http://", "https://", "mailto:", "#", "tel:")):
                        continue
                    if target.startswith("/"):
                        issues.append("%s 使用绝对路径链接：%s" % (rel_path, target))
                        continue
                    try:
                        parsed = urlsplit(target)
                    except ValueError:
                        issues.append("%s 链接格式无效：%s" % (rel_path, target))
                        continue
                    if parsed.scheme == "file":
                        if parsed.netloc.lower() not in ("", "localhost"):
                            issues.append("%s 使用非本地主机 file URI：%s" % (rel_path, target))
                            continue
                        target = unquote(parsed.path)
                    else:
                        # 避免把普通相对文件名中的冒号当作 URI scheme。
                        target = unquote(urlsplit("./" + target).path[2:])
                    if parsed.scheme != "file" and target.startswith("/"):
                        issues.append("%s 使用绝对路径链接：%s" % (rel_path, target))
                        continue
                    if not target:
                        continue
                    # 本地 file URI 的绝对路径不拼接文档目录；相对路径仍以文档目录为基准。
                    resolved = os.path.normpath(os.path.join(root, target))
                    if not os.path.exists(resolved):
                        issues.append("%s 链接目标不存在：%s" % (rel_path, target))


def check_table_count(issues):
    schema = read(BASELINE)
    actual = len(re.findall(r"^CREATE TABLE", schema, re.M))
    header = re.search(r"\((\d+) tables?\)", schema[:1200])
    if header and int(header.group(1)) != actual:
        issues.append("基线表数量口径不一致：头部写 %s，实际 CREATE TABLE %d" % (header.group(1), actual))

    checks = [
        ("README.md", r"(\d+) 张表"),
        ("README.en.md", r"(\d+) tables"),
        ("docs/管理员指南.md", r"全库 (\d+) 张表"),
        ("frontend/管理员指南.md", r"全库 (\d+) 张表"),
        ("sql/README.md", r"基线包含当前全部 (\d+) 张表"),
        ("docs/接口契约.md", r"完整基线包含 (\d+) 张表"),
        ("docs/接口契约.md", r"完整基线同步为 (\d+) 张表"),
        ("docs/项目介绍.md", r"全库 (\d+) 表"),
        ("frontend/项目介绍.md", r"全库 (\d+) 表"),
    ]
    for rel, pattern in checks:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            issues.append("缺少文件：%s" % rel)
            continue
        m = re.search(pattern, read(path))
        if not m:
            issues.append("%s 未找到表数量口径" % rel)
        elif int(m.group(1)) != actual:
            issues.append("%s 表数量写 %s，基线实际 %d" % (rel, m.group(1), actual))


def main():
    issues = []
    check_copies(issues)
    check_links(issues)
    check_table_count(issues)
    if issues:
        print("FAIL：文档一致性检查发现 %d 项问题" % len(issues))
        for item in issues:
            print(" - " + item)
        return 1
    print("OK：文档副本同步（含三份手册）、本地链接有效、表数量口径一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
