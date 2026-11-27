# SQL 目录说明

沙漏的数据库结构只有一条“全新安装”入口和一条“已有库升级”入口，避免同时维护两套建库脚本。

## 1. 全新安装

只执行基线：

```bash
mysql -uroot -p --default-character-set=utf8mb4 < sql/baseline/01_schema_full.sql
```

基线包含当前全部 94 张表（含已部署交付闭环、跨版本计划关联、新成员默认不参与、成员公司/项目角色标注、成员职能标签选项、需求人工交付判定、版本终态、版本承诺基线、项目里程碑、交付说明、编号序列、用例—工作项追溯、用例目录层级 / 自定义分组（动态收录与指定成员可见）、文档分类树与空间级文档、子任务排序与团队共享 AI 配置、Git 仓库只读同步与分支别名、文档可见范围、工作项历史发布人工标记、需求池评论与需求提醒人、需求已完成主状态、项目集与项目拆分映射、需求评审人、测试计划执行人、发布准备与发布计划关注、交付说明分享访问明细、周五补记与未处理项承接、轻量自动化与定时报告订阅、工作项创建人）、索引与全文索引，执行后无需再跑根目录的增量脚本。**正常部署只用于新空库**：完整基线会重建表，不是幂等无损升级脚本，不得作为普通升级在已有数据的库上重跑。本轮交付闭环经用户单独明确授权，原 `hourglass` 46 表先受限备份并恢复验证，再 DROP / CREATE 为 52 表；原历史在备份中，不再原表在线保留，不回放 61/62、不迁移旧历史。认证 JDBC 与 `DB_NAME=hourglass`，`hourglass_20261110` 保留额外回退点；此授权不是默认部署删库许可，软件-only 回退不足，匹配 SQL 恢复另须单独授权。基线需要 `CREATE DATABASE` / `CREATE USER` / `GRANT` 权限，建议用 root 执行。应用账号固定为 `hourglass` @ `%`（允许外部连接），密码 `Dzqh@123456`；外部直连还需 MySQL `bind-address` 允许非本机连接并放行 3306。

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

`92_case_creator_run_env.sql` 给 `test_case` 增 `created_by` / `created_by_user_id`（创建时写入、不随执行变化，区分「谁写的用例」与「谁执行的」），给 `test_case_run` 增 `environment`（执行环境，转缺陷时预填）。只增结构、幂等可重复执行；历史用例与执行记录不回填创建人/环境，旧数据没有可靠记录时不伪造。

`98_git_repo_sync.sql` 支持项目多仓库 Git 只读同步：新建 `project_repo`（仓库地址、GitLab 项目标识、默认目标分支、AES-GCM 令牌密文、导入策略 `recent90` / `all` / `manual`、启停与最近同步结果）与 `dev_branch_alias`（同一 SHA 的删旧建新识别为改名）；`dev_branch` 增远程事实（`remote_state` / `remote_head_*` / `last_seen_*`）、合并证据（`merged*` / `merge_evidence`）、人工判定（`decision*` / `decided_*`）、生命周期 `outcome`（open / done / canceled / ignored / pending）与 `pending_reason`、`sync_status`、`sync_error`，并用生成列 `owner_key` 把唯一键从 `uk_ws_req_name` 换成 `uk_ws_owner_name`（仓库分支按 repo 隔离、手工分支按项目隔离），新增 `idx_ws_outcome` / `idx_ws_repo_state`；`dev_branch_log` 增 `actor_type` 区分人工与系统同步。脚本幂等、只增结构，不物理删除分支、不回填历史提交事实；执行时须带 `--default-character-set=utf8mb4`。

`100_case_category_tree.sql` 把用例目录合并进项目目录：`category` 增 `parent_id`（同级同名唯一，名称上限放宽到 50），`test_module` 节点沿用原 id 迁入，顶层同名节点合并到任务 / 需求已在用的 `category` 并改写用例 `module_id` 与动态分组 `rule_json.moduleId`；`case_set` 增 `parent_id` 支持嵌套分组，`test_case` 增 `sort_order` 支持手动排序。`test_module` 表保留用于回滚，服务层不再读写；脚本幂等、不改编号与执行历史。

`101_doc_category_default_visibility.sql` 给文档分类加默认可见范围：`doc_category` 增 `visibility`（team / members / personal，默认 team）与 `member_ids`（逗号分隔的账号 ID，最多 50 人）。它只是默认值、不参与可见判定：新建文档挂在分类上且未显式指定可见范围时复制成文档自己的设置，之后每篇仍可单独调整；存量文档与把文档换到该分类都不会被自动改。不新建表、不需要级联清理或备份调整；脚本幂等，无需回填。

`102_task_publication_judgement.sql` 新增 `task_publication_judgement`（工作项历史发布人工标记）：`judged_state` 固定 `published`，记录生效日期、原因与标记人；追加式留痕，撤销后保留历史，`active_task_id` 生成列 + 唯一键保证同一工作项最多一条生效标记。它只补录从其他系统迁移、没有发布记录的历史事实，仅影响工作项徽标与「发布态」筛选；不写入 `version_release` / `version_release_item`，不改 `publicationState`，也不参与需求交付阶段派生、交付说明与版本统计。撤销后回落为「未发布」。脚本只建表，不回填、不推断历史标记；表随工作项或空间删除一并清理。

`103_demand_comment.sql` 新增 `demand_comment`（需求池评论）：一层回复、解决/重开、@提及、评论转工作项回链，能力口径与文档评论一致。评论随需求硬删除或空间清空一并清理；工作项被彻底删除时保留评论、只清 `task_id` 回链。脚本只建表，不回填；执行后完整基线为 77 张表（再接 104 为 78 张表）。

`104_demand_watch.sql` 新增 `demand_watch`（需求提醒人）：一条需求一份共享关注名单，主键 `(demand_id, user_id)`，`added_by` 记录是本人关注还是他人添加。名单只决定通知收件人，不参与权限判定；提交人始终默认接收通知，不写入名单。名单随需求硬删除、空间清空、导入覆盖、成员退出空间或账号删除一并清理；JSON 任务备份不携带关注关系，恢复后为空。脚本只建表，不回填；执行后完整基线为 78 张表。

`105_demand_done_status.sql` 为主状态机补「已完成 `done`」：`review → pass → plan → done`，`closed` 仍是异常终止；交付阶段改为在 `plan` / `done` 上的只读派生展示，完成不等于交付。脚本不新增表，只回填存量 `plan` 需求：有成功、生产、全量覆盖且未被后续回滚撤销的发布条目优先置 `done`，其次生效的人工交付判定（判定版本须等于当前目标版本），最后是「至少 1 个未删除工作项全部处于完成列且关联用例最新执行全部通过」；其余需求保持原状态。回填同时追加 `demand_log`（`action='complete'`），脚本幂等，执行后完整基线仍为 78 张表。

`106_project_set.sql` 是项目集与流程引擎拆分的单文件增量（结构 + 数据一次执行）：新增 `project_set` 与 `project_split_map` 两张表，给 `requirement` 加 `set_id` / `origin_category_id` / `container_kind` 及 `idx_ws_set`，给 `demand` 加 `version_name` 快照列；把流程引擎的 7 个一级分类升为项目、原项目改为容器「流程引擎-公共」，并按分类迁移工作项、需求、用例、用例集与完成归档。结构变更按 `information_schema` 判重，数据迁移以映射表判重、在单事务内执行，重复执行跳过；版本、发布、文档留在容器，`version_task` 与需求版本引用按 D9/D10 清理并留快照。迁移闸门按 7 个固定一级分类 ID 与「尚未拆分、新项目 ID 未占用」判断，不绑定决策时的任务 / 需求 / 用例条数，决策后正常新增的数据不会让拆分静默跳过。线上已是 78 表（102–104 已执行）时，本次按序执行 105 → 108；若仍是 75 表，先补 102–104。102–104 均为 `CREATE TABLE IF NOT EXISTS`，被部署脚本按改动重放也不会有副作用。全新安装只跑基线（已含本项目结果，共 80 张表）。

`107_project_set_followup.sql` 是 106 之后的纯数据修正：清空拆分时从容器继承来的 `requirement.first_released_at`（子项目没有自己的成功生产发布，继承日期会让版本页「首版开发」恒为 0，等子项目真实首版发布后再标记），并为仍有未分组项目的空间补默认项目集「其他项目」、把 `set_id IS NULL` 的项目挂进去。全部变更在单事务内，按事实校验与 `(workspace_id, name)` 判重，可重复执行。

`108_demand_done_backfill.sql` 是「已完成 done」的回填与历史修复（纯数据，无结构变更），应在 105、106 之后执行：106 迁移了工作项 / 需求的所属项目并清空拆分需求的 `version_id`，完成证据随之变化。判定与 `DemandCompletionService.selectCompletionEvidence` 完全一致——成功生产发布条目、绑定当前目标版本的人工交付判定、或「至少 1 个未删除工作项全部完成且关联用例最新执行全部通过」——满足任一即 `plan → done`；`done` 但证据已全部失效则退回 `plan`（`done` 没有人工入口，与后端自动退回一致）；缺完成日志的历史数据补齐 `demand_log`。状态更新带原状态条件、日志只在同类动作缺失时补写，脚本幂等，执行后基线表数量不变。

`109_task_canceled.sql` 为工作项新增终态「已取消」。

`112_task_test_estimate.sql` 给 `task` 增加 `test_estimate_minutes`（测试预估，分钟，空=没估过）：成员负载的测试剩余 = max(0, 测试预估 − 测试窗口内已计工时)，只对测试负责人身份下的「待测试 / 测试中」项累加并并入该成员总负载；整体预估的含义与开发剩余不变，两者各自独立。只增可空列，不回填历史数据，执行后表数量不变。

`113_demand_reviewer.sql` 给 `demand` 增加可空列 `reviewer_user_id`（需求评审人）：指派后「待我评审」优先展示，空值仍进入公共可认领队列。只增可空列，不改状态机、不回填，执行后表数量不变。

`114_test_plan_executor.sql` 给 `test_plan` 增加可空列 `executor_user_id`（测试计划执行人）：空值不进入任何人的「待我执行」。只增可空列，不改执行记录，执行后表数量不变。

`115_release_prep.sql` 新增发布准备的 5 张表：`version_release_plan_watch`（计划关注人）、`version_release_plan_push`（推送批次）、`version_release_plan_push_recipient`（收件人与回执）、`version_release_plan_task_check`（逐项确认 / 风险）、`version_release_plan_milestone`（T-7 / T-3 / T-1 / T-0 发送记录）。关注独立于 `task_watch` / `demand_watch`，只在「我的工作 → 我的关注」统一展示；逐项确认不外键到计划任务行，计划保存删除重建时不会跟着丢。只建表，不回填；115–121 与 123 依次新增发布准备 5 表、交付说明访问明细 1 表、周五补记 4 表、自动化与报告订阅 3 表、周五补记承接 1 表，完整基线为 94 张表。

`116_release_prep_note.sql` 给 `version_release_plan_push` 增加 `note`（发送时选填的补充说明，最多 200 字）。说明随批次持久化，追加在固定事实句之后进入站内 / 邮件 / 群消息，不替换计划名、发布时间、行动句与深链；说明不同、收件人集合不同都视为新批次。依赖 115 先执行；只增可空列，执行后表数量不变。

`117_release_prep_push_group_result.sql` 给 `version_release_plan_push` 增加 `group_sent` / `group_error`，记录企业微信群这一批是否发送成功及失败原因；`NULL` 表示未选群渠道或历史批次未记录。群消息按空间群发送、不能按人回执，这两个字段只用于计划页和推送记录展示。依赖 115 先执行；只增可空列，不回填，执行后表数量不变。

`118_saved_view_params_length.sql` 把 `saved_view.params` 放宽到 `varchar(2000)`，让保存视图能存下多条筛选组合；不新增表、不回填。

`119_delivery_share_hardening.sql` 给交付说明分享加 `password_hash`（BCrypt 访问密码）、`allowed_domains`（域名白名单）与 `watermark_text`（接收页 / 打印水印），并新建 `delivery_note_share_visit` 记录每次打开、密码通过与下载的时间、IP、来源域名与 UA；只加列与建表，执行后 86 张表。

`120_catchup.sql` 新增周五补记 4 张表：`catchup_session`（按人按周的会话与计时）、`catchup_decision`（逐条确认 / 跳过 / 合并 / 编辑）、`catchup_time_alloc`（按项目与自然日的工时归属）、`catchup_write`（提交后 5 分钟内可撤销的写入台账）。补记只追加确认记录与工时，不自动改工作项状态；执行后 90 张表。

`121_automation_reports.sql` 新增 3 张表：`workspace_automation`（空间级三条内置规则开关与参数）、`automation_run`（同一空间 + 规则 + 对象 + 自然日去重并留最近结果）、`report_subscription`（个人周报 / 版本报告订阅的渠道、星期、小时与最近发送时间）。只建表、不改存量数据；执行后 93 张表。

`122_app_notification_req_id.sql` 给 `app_notification` 增加可空列 `req_id` 与索引 `idx_user_ws_req`：非任务通知写入时固化所属项目，列表、未读数与类型计数统一按它过滤项目可见性，项目被设为「不可见」后需求/文档等历史通知同步隐藏（`project_access` 权限调整告知除外，始终保留）。无法唯一归属一个项目的通知（如跨项目发布计划）保持空值、继续可见；历史行按 `ref_kind` 关联需求/文档/计划/分支/版本回填，关联不到的不误伤。脚本可重复执行，执行后表数量不变。

`123_catchup_carry.sql` 新增 `catchup_carry`：提交周五补记时把「未处理 / 跳过」的工作项快照到下周（`from_session_id` + `task_id` 唯一），下周草稿据此继续列出；撤销提交时按会话删除。只建表、不回填业务数据；执行后 94 张表。

`124_task_creator.sql` 给 `task` 增加可空列 `created_by_user_id` 与索引 `idx_creator`，记录建单人（「我的工作 → 我发起的」据此跨空间跟踪）。建单写入当前账号，编辑、转派与列流转不改；历史数据按 `task_log` 中每个任务首条 `action='create'` 的 `actor_id` 回填，没有创建日志的留空不做推断。脚本幂等，执行后表数量不变。

`126_release_artifact_digest_optional.sql` 把 `version_release.artifact_digest` 从 `NOT NULL` 放宽为可空：没有 CI / 制品库的团队可以留空表示「未记录校验值」，不再被 64 位哈希卡住。字段长度、历史值、发布判重与回滚的产物比较都不变；填写时后端仍强制 64 位十六进制，commit id 仍不能冒充制品哈希。脚本按 `information_schema` 判断可空性，已放开的库跳过，执行后表数量不变。

`127_workspace_release_access_scope.sql` 给 `workspace` 增加 `release_access_scope`，把「谁能维护发布计划与发布记录」做成空间级多选配置：`owner`（空间主）、`admin`（管理员）、`project_owner`（项目负责人且该项目可写）、`project_write`（该项目可写成员），逗号分隔，默认 `owner,admin,project_owner`，与调整前的管理者口径一致。只增列并给默认值、不回填；查看者始终无权；版本新建 / 编辑 / 内容调整仍按项目写权限，不读这一列。脚本按 `information_schema` 判断列是否存在，可重复执行，表数量不变。

`128_doc_edit_trash_share.sql` 给 `requirement_doc` 增加 `deleted_at` / `deleted_by` 与 `idx_ws_deleted`，让「删除文档」改为移入回收站（保留 30 天，可恢复 / 彻底删除）；正常列表、搜索与需求统计只查 `deleted_at IS NULL`。同时给 `req_doc_share` 增加 `allow_copy`（默认 1），分享链接可选择是否允许查看者复制与打印；有效期仍沿用 `expires_at`，不新增列。脚本按 `information_schema` 判断列 / 索引是否存在，可重复执行，表数量不变。

`129_workspace_publication_access_scope.sql` 给 `workspace` 增加 `publication_access_scope`，把「谁能人工标记工作项发布状态」做成空间级多选配置：`owner`（空间主）、`admin`（管理员）、`project_owner`（项目负责人且该项目可写）、`project_write`（该项目可写成员），逗号分隔，默认 `owner,admin,project_owner`，与调整前的管理者口径一致。只增列并给默认值、不回填；人工标记仍只影响徽标与「发布态」筛选，不写发布记录、不进交付统计。脚本按 `information_schema` 判断列是否存在，可重复执行，表数量不变。

`130_backfill_publication_list_column.sql` 给已有列表列偏好补入「发布态」列：工作项列表新增 `publication` 并进入默认列集，但默认值只对新用户生效；这里只对 `view_key='task-list'` 且尚未包含 `publication` 的行追加该列（优先插到 `updatedAt` 之前），不动结构、不动业务数据。已包含该列的行跳过，可重复执行；用户后续在「显示字段」里主动隐藏后不会再次补回。

`110_task_comment_content_length.sql` 只把 `task_comment.content` 从 `VARCHAR(500)` 放宽到 `VARCHAR(2000)`，让工作项评论能贴下错误日志与会议结论；不新增字段、不回填、不改权限与通知口径。后端截断上限与抽屉输入框 `maxlength` 同步为 2000。脚本按 `information_schema` 判断当前长度，已达标即跳过，可重复执行；执行后表数量不变。

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
