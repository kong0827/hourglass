# SQL 目录说明

沙漏的数据库结构只有一条“全新安装”入口和一条“已有库升级”入口，避免同时维护两套建库脚本。

## 1. 全新安装

只执行基线：

```bash
mysql -uroot -p --default-character-set=utf8mb4 < sql/baseline/01_schema_full.sql
```

基线包含当前全部 47 张表、索引与全文索引，执行后无需再跑根目录的增量脚本。基线需要 `CREATE DATABASE` / `CREATE USER` / `GRANT` 权限，建议用 root 执行。

## 2. 已有库升级

按文件名顺序执行 `sql/` 根目录的 `NN_*.sql` 增量脚本即可，全部幂等。`deploy/deploy.sh` 会自动检测并执行改动过的脚本，也可用 `--sql-all` 强制重放。

> 注意：`61_category_id.sql` 与 `62_category_project.sql` 是结构切换脚本，**不做历史回填**，会删除旧的空间级模块并清空工作项/需求的模块引用；已有真实数据的库执行前必须先备份，或跳过这两个脚本并自行补数据。

不要执行 `sql/legacy/` 与 `sql/seeds/` 下的文件；前者只保留旧版本结构用于追溯，后者是旧结构的演示种子。

## 3. 基线漂移校验

发布前运行：

```bash
python3 tools/check_baseline_drift.py
```

它会把根目录所有增量脚本里的表、列、索引与 `sql/baseline/01_schema_full.sql` 对照，避免“基线漏列、首次请求 500”。

## 4. 演示数据

`sql/seeds/` 下的种子脚本生成于模块改为项目级之前，包含旧的 `task.category` / 空间级 `category` 写法，**不能直接导入当前基线**。当前推荐：

- 本地起空库后，用后端启动引导的 `admin` 账号在界面创建项目与数据；
- 或先用旧基线 + 旧种子重建演示环境，再按 61/62 号迁移说明升级。

种子脚本将在后续单独升级到 `category_id` / `project_id` 结构；在此之前不要把 `sql/seeds/` 当作全新安装步骤。各文件来源与状态见 [`seeds/README.md`](seeds/README.md)。
