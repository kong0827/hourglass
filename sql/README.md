# SQL 目录说明

沙漏的数据库结构只有一条“全新安装”入口和一条“已有库升级”入口，避免同时维护两套建库脚本。

## 1. 全新安装

只执行基线：

```bash
mysql -uroot -p --default-character-set=utf8mb4 < sql/baseline/01_schema_full.sql
```

基线包含当前全部 52 张表（含未发布交付闭环）、索引与全文索引，执行后无需再跑根目录的增量脚本。**只用于新空库**：完整基线会重建表，不是幂等无损升级脚本，不得在已有数据的库上重跑。本轮交付闭环只在独立新空库启用，不回放 61/62，不迁移旧历史，保留原库与原数据。基线需要 `CREATE DATABASE` / `CREATE USER` / `GRANT` 权限，建议用 root 执行。

## 2. 已有库升级

既有已发布结构的升级按发布说明评估并按编号执行所需 `NN_*.sql` 增量脚本；可重复执行不等于无损，不能把完整基线或全部编号脚本当作安全重放方案。`deploy/deploy.sh` 的增量路径会检测改动过的脚本；本轮 A–E 不走已有库迁移，也不使用 `--sql-all` 重放旧脚本。

> 注意：`61_category_id.sql` 与 `62_category_project.sql` 是破坏性结构切换脚本，**不做历史回填**，会删除旧的空间级模块并清空工作项/需求的模块引用；已有真实数据的库不能据此直接升级。本轮保留原库，在独立新空库启用，不回放这两个脚本、不迁移旧历史。

`63_delivery_release.sql` 属于**未发布在制改动**，仅增列与创建五张表：`version_release_plan`、`version_release_plan_task`、`version_release`、`version_release_item`、`version_log`；新增需求计划日期 / revision、任务发布徽标及日志结构字段。已有 `version_task` 存任务当前 M:N 计划版本集合，`version_release_plan_task` 存独立计划的任务范围，不替代实际事件范围。本轮只用新空库基线，不以 63 对旧库迁移；脚本不回填、不清空，不根据首版统计、旧版本状态或完成任务构造历史发布证据，旧记录缺失必须明确显示无正式证据。JSON 任务备份不是正式发布凭证；以上五表应随 MySQL 全库备份保留，恢复包含计划任务范围。

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
- 当前模型的完整模拟在本地独立新 namespace 创建，full 模拟与 990 回读已通过（规模与独立统计见 [`CHANGELOG.md`](../CHANGELOG.md)），不算生产部署或生产 seed；本轮不从旧种子回放 61/62，不迁移旧历史。

不要把 `sql/seeds/` 当作当前全新安装步骤。各文件来源与状态见 [`seeds/README.md`](seeds/README.md)。
