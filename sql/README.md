# SQL 目录说明

沙漏的数据库结构只有一条“全新安装”入口和一条“已有库升级”入口，避免同时维护两套建库脚本。

## 1. 全新安装

只执行基线：

```bash
mysql -uroot -p --default-character-set=utf8mb4 < sql/baseline/01_schema_full.sql
```

基线包含当前全部 55 张表（含已部署交付闭环、跨版本计划关联、新成员默认不参与与成员公司/项目角色标注）、索引与全文索引，执行后无需再跑根目录的增量脚本。**正常部署只用于新空库**：完整基线会重建表，不是幂等无损升级脚本，不得作为普通升级在已有数据的库上重跑。本轮交付闭环经用户单独明确授权，原 `hourglass` 46 表先受限备份并恢复验证，再 DROP / CREATE 为 52 表；原历史在备份中，不再原表在线保留，不回放 61/62、不迁移旧历史。认证 JDBC 与 `DB_NAME=hourglass`，`hourglass_20261110` 保留额外回退点；此授权不是默认部署删库许可，软件-only 回退不足，匹配 SQL 恢复另须单独授权。基线需要 `CREATE DATABASE` / `CREATE USER` / `GRANT` 权限，建议用 root 执行。

## 2. 已有库升级

既有已发布结构的升级按发布说明评估并按编号执行所需 `NN_*.sql` 增量脚本；可重复执行不等于无损，不能把完整基线或全部编号脚本当作安全重放方案。`deploy/deploy.sh` 的增量路径会检测改动过的脚本；本轮 A–E 不走已有库迁移，也不使用 `--sql-all` 重放旧脚本。

> 注意：`61_category_id.sql` 与 `62_category_project.sql` 是破坏性结构切换脚本，**不做历史回填**，会删除旧的空间级模块并清空工作项/需求的模块引用；已有真实数据的库不能据此直接升级。本轮原库重建属用户单独授权、先受限备份并恢复验证的操作，不回放这两个脚本、不迁移旧历史；原历史仅在备份中保留。

`63_delivery_release.sql` 的契约已随 A–E 部署，仅增列与创建五张表：`version_release_plan`、`version_release_plan_task`、`version_release`、`version_release_item`、`version_log`；新增需求计划日期 / revision、任务发布徽标及日志结构字段。已有 `version_task` 存任务当前 M:N 计划版本集合，`version_release_plan_task` 存独立计划的任务范围，不替代实际事件范围。本轮授权重建原库使用 52 表基线，不以 63 对旧库迁移；脚本不回填、不清空，不根据首版统计、旧版本状态或完成任务构造历史发布证据，旧记录缺失必须明确显示无正式证据。JSON 任务备份不是正式发布凭证；以上五表应随 MySQL 全库备份保留，恢复包含计划任务范围。

`65_release_plan_versions.sql` 只新增第六张发布相关表 `version_release_plan_version`（计划与版本的关联），并回填现有单版本计划；它不修改 `version_release` 实际事件，也不构造历史证据。一个计划由此可覆盖多个版本 / 项目，计划完成仍以全部包含版本的成功生产部署 / 重部署为准。

`66_project_access_assigned.sql` 新增 `workspace_member.project_access_mode`（`all` / `assigned`）与 `invite_project_grant` 表，并为 `assigned` 成员补齐 `project_member.access='none'` 种子行。存量成员默认 `all`，升级后可见范围不变；新成员与邀请加入者写 `assigned`，未显式授权的项目一律不可见。脚本只补缺，不覆盖已有 `write` / `read` / `none`。

`67_bug_regression_backfill.sql` 只为存量缺陷补齐缺失的回归状态：`test` / `testing` 补 `pending`，`done` 补 `passed`；已有值不动，`backlog` / `doing` 保持为空。此后回归状态由后端随列流转维护，完成与回归通过同时成立才算关闭。

`68_member_company_project_role.sql` 为 `workspace_member` 增 `company_name`，并创建 `project_member_role`（主键 `workspace_id + project_id + user_id`）。脚本幂等、只增结构、不回填历史；公司为空间级自由文本，项目角色为成员×项目的唯一主角色，两者仅展示，不参与鉴权。成员移出空间/项目、项目或空间删除时同事务清理角色行。

`64_task_test_flow.sql` 增量补齐测试流程：`task` 增加 `test_started_at` / `test_finished_at`，并为每个空间补「待测试」「测试中」两个内置列。新列插在「进行中」之后，同位置的自定义列按原相对顺序顺延；不回填历史测试时间，旧数据没有可靠记录时不伪造时间。执行时须带 `--default-character-set=utf8mb4`，否则列名中文会写成乱码。

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
- 本地独立 namespace full 模拟与 990 回读已通过，独立于本次已完成的完整生产模拟（8 模拟用户／4 共享空间／11 项目／33 版本／66 需求／275 任务／44 计划／66 事件，另有 admin 与自动个人空间）。生产只读 1747 GET／3 login，7463 有效断言零失败／零 API 错误；完整生产 52 表 SQL 空库恢复验证已完成，生产 Chrome 1440/390px、24 次入口导航、93 项有效断言通过，0 runtime/console/HTTP 错误。详细规模、计数与 DDL 比较边界见 [`CHANGELOG.md`](../CHANGELOG.md)；本轮不从旧种子回放 61/62，不迁移旧历史。

不要把 `sql/seeds/` 当作当前全新安装步骤。各文件来源与状态见 [`seeds/README.md`](seeds/README.md)。
