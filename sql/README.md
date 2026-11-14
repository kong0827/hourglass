# SQL 目录说明

沙漏的数据库结构只有一条“全新安装”入口和一条“已有库升级”入口，避免同时维护两套建库脚本。

## 1. 全新安装

只执行基线：

```bash
mysql -uroot -p --default-character-set=utf8mb4 < sql/baseline/01_schema_full.sql
```

基线包含当前全部 66 张表（含已部署交付闭环、跨版本计划关联、新成员默认不参与、成员公司/项目角色标注、成员职能标签选项、需求人工交付判定、版本终态、版本承诺基线、项目里程碑、交付说明、编号序列与用例—工作项追溯）、索引与全文索引，执行后无需再跑根目录的增量脚本。**正常部署只用于新空库**：完整基线会重建表，不是幂等无损升级脚本，不得作为普通升级在已有数据的库上重跑。本轮交付闭环经用户单独明确授权，原 `hourglass` 46 表先受限备份并恢复验证，再 DROP / CREATE 为 52 表；原历史在备份中，不再原表在线保留，不回放 61/62、不迁移旧历史。认证 JDBC 与 `DB_NAME=hourglass`，`hourglass_20261110` 保留额外回退点；此授权不是默认部署删库许可，软件-only 回退不足，匹配 SQL 恢复另须单独授权。基线需要 `CREATE DATABASE` / `CREATE USER` / `GRANT` 权限，建议用 root 执行。应用账号固定为 `hourglass` @ `%`（允许外部连接），密码 `Dzqh@123456`；外部直连还需 MySQL `bind-address` 允许非本机连接并放行 3306。

## 2. 已有库升级

既有已发布结构的升级按发布说明评估并按编号执行所需 `NN_*.sql` 增量脚本；可重复执行不等于无损，不能把完整基线或全部编号脚本当作安全重放方案。`deploy/deploy.sh` 的增量路径会检测改动过的脚本；本轮 A–E 不走已有库迁移，也不使用 `--sql-all` 重放旧脚本。

> 注意：`61_category_id.sql` 与 `62_category_project.sql` 是破坏性结构切换脚本，**不做历史回填**，会删除旧的空间级模块并清空工作项/需求的模块引用；已有真实数据的库不能据此直接升级。本轮原库重建属用户单独授权、先受限备份并恢复验证的操作，不回放这两个脚本、不迁移旧历史；原历史仅在备份中保留。

`63_delivery_release.sql` 的契约已随 A–E 部署，仅增列与创建五张表：`version_release_plan`、`version_release_plan_task`、`version_release`、`version_release_item`、`version_log`；新增需求计划日期 / revision、任务发布徽标及日志结构字段。已有 `version_task` 存任务当前 M:N 计划版本集合，`version_release_plan_task` 存独立计划的任务范围，不替代实际事件范围。本轮授权重建原库使用 52 表基线，不以 63 对旧库迁移；脚本不回填、不清空，不根据首版统计、旧版本状态或完成任务构造历史发布证据，旧记录缺失必须明确显示无正式证据。JSON 任务备份不是正式发布凭证；以上五表应随 MySQL 全库备份保留，恢复包含计划任务范围。

`65_release_plan_versions.sql` 只新增第六张发布相关表 `version_release_plan_version`（计划与版本的关联），并回填现有单版本计划；它不修改 `version_release` 实际事件，也不构造历史证据。一个计划由此可覆盖多个版本 / 项目，计划完成仍以全部包含版本的成功生产部署 / 重部署为准。

`66_project_access_assigned.sql` 新增 `workspace_member.project_access_mode`（`all` / `assigned`）与 `invite_project_grant` 表，并为 `assigned` 成员补齐 `project_member.access='none'` 种子行。存量成员默认 `all`，升级后可见范围不变；新成员与邀请加入者写 `assigned`，未显式授权的项目一律不可见。脚本只补缺，不覆盖已有 `write` / `read` / `none`。

`67_bug_regression_backfill.sql` 只为存量缺陷补齐缺失的回归状态：`test` / `testing` 补 `pending`，`done` 补 `passed`；已有值不动，`backlog` / `doing` 保持为空。此后回归状态由后端随列流转维护，完成与回归通过同时成立才算关闭。

`68_member_company_project_role.sql` 为 `workspace_member` 增 `company_name`，并创建 `project_member_role`（主键 `workspace_id + project_id + user_id`）。脚本幂等、只增结构、不回填历史；公司为空间级自由文本，项目角色为成员×项目的唯一主角色，两者仅展示，不参与鉴权。成员移出空间/项目、项目或空间删除时同事务清理角色行。

`78_version_end_state.sql` 为 `project_version` 增加 `ended_at` / `end_reason`，支持版本「关闭 / 取消」终态：关闭表示本轮交付结束但未发布，取消表示本轮作废；两者都必须记录原因，历史与工作项关联保留。取消版本不计入「已发布 / 进行中 / 计划中」节奏统计，关闭与取消版本都不能再加入发布计划或新增工作项。

`79_version_commitment.sql` 增加承诺基线：`project_version` 增 `commitment_at`（进入开发中时只写一次），新建 `version_commitment_task` 保存当时绑定的工作项、标题与预估。基线不随后续增删或改预估回写；版本统计只按当前绑定与基线做差集，旧版本没有快照时展示为空。表随项目/空间删除或任务数据整体清空一并清理。

`80_project_milestone.sql` 把里程碑从工作项布尔标记升级为项目级对象：新建 `project_milestone`（名称、达成方式 `version` / `tasks` / `manual`、目标日期、负责人、关键标记、版本或工作项条件、达成与取消信息、`revision`）、`project_milestone_task`（工作项条件引用）与 `project_milestone_log`（创建 / 改期 / 取消 / 达成 / 撤销日志）。脚本把存量 `task.is_milestone=1` 的工作项一次性映射为「人工确认」型迁移里程碑，但**不删除** `task.is_milestone` 列：旧客户端与旧甘特仍读取该标记。里程碑不进入工作项计数、预估与燃尽；表随项目 / 空间删除或任务数据整体清空一并清理。

`81_delivery_note.sql` 新增一页式交付说明三张表：`delivery_note`（人工层与生成控制）、`delivery_note_snapshot`（导出瞬间的不可变聚合与正式编号）、`delivery_note_share`（快照级只读令牌）。数字实时来自版本、发布、测试与工时记录，脚本不回填、不构造历史交付证据；快照冻结后不再随业务数据变化，撤销分享只影响令牌，不修改快照本身。

`77_task_test_owner.sql` 增量补齐测试负责人：`task` 增加 `test_owner_user_id` / `test_owner`（测试负责人账号与显示名快照）和 `test_requested_at`（提测时间），并把 `test_started_at` / `test_finished_at` 从 DATE 提升为 DATETIME，新增 `(workspace_id, test_owner_user_id, board_column)` 索引。旧 DATE 值按当天 00:00 保留，不回填、不推断历史时刻；脚本只增结构，可重复执行。负责人仍表示开发责任人，测试负责人由流转与抽屉维护。

`64_task_test_flow.sql` 增量补齐测试流程：`task` 增加 `test_started_at` / `test_finished_at`，并为每个空间补「待测试」「测试中」两个内置列。新列插在「进行中」之后，同位置的自定义列按原相对顺序顺延；不回填历史测试时间，旧数据没有可靠记录时不伪造时间。执行时须带 `--default-character-set=utf8mb4`，否则列名中文会写成乱码。

`82_work_item_release_no.sql` 针对交付说明与发布快照里直接露出 32 位随机 ID、无法口头或跨系统引用的问题：`task` 增 `item_no`（展示 `WI-001`）、`version_release` 增 `release_no`（展示 `REL-001`），均为项目内顺序号，与 74 号用例编号同构。`task.req_id` 可空，另加生成列 `no_scope` 把「无项目」归到空串，唯一键才对无项目工作项生效；编号列可空，未取号行不参与唯一约束，脚本可先于后端上线执行。回填按创建时间（发布记录按实际发生时间）排序、只补空值，软删除行一并占号；换项目重新取号，改类型不换号。

`83_release_item_no.sql` 针对发布快照读取时 join 当前工作项、换项目后旧记录显示成新编号的问题：`version_release_item` 增 `task_item_no`，与 `title` / `owner_name` 一样在记录当时定格。存量快照按当前 `task.item_no` 回填（能拿到的最接近事实的编号），任务已彻底删除时留空、前端回退显示原 ID；脚本只增结构，可重复执行。

`88_case_task_traceability.sql` 新增 `test_case_task`（用例验证的工作项，多对多）并给 `test_plan_case` 增 `required`（发布必测）。用例仍只有一个主需求 `test_case.demand_id`，关联工作项必须属于该主需求；历史用例不回填关联，没有工作项链时按「需求级覆盖」展示。脚本幂等、不构造历史证据。

`89_release_test_check.sql` 给 `requirement` 增 `release_check_policy`（strict/standard/loose，默认 standard）。发布前检查按该策略区分阻断与提醒；只读取用例与计划结果，不改变任务状态，确认发布时把结论冻结进 `version_release.plan_snapshot.testEvidence`。

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
