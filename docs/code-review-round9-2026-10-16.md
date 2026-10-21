# 第九轮代码审查（2026-10-16）

## 审查结论

本轮以静态阅读为主，逐文件复核了 `service` / `mapper` / `controller` / `config` / 前端 `static/js` 的全部核心链路，并逐条核对了鉴权与数据清理路径。

**发现 1 个 P2（数据清理遗漏，方法已定义但从未接线）与 8 个 P3（边界、口径、死代码、防御性问题）。未发现 P0/P1。**

第八轮报告的 P2（保存任务的迟到成功响应会关闭另一个任务的编辑弹窗）经复核**已修复**：`app.js:171` 引入 `taskFormSeq`，`openTaskDrawer`（`:1941`）与 `forceCloseTaskDrawer`（`:2057`）递增代次，保存回调在 `:2294` 捕获、`:2305`/`:2328` 校验后才改动界面。

已接受的现状口径（本轮不重复报告）：会话不踢线、任务最后写入生效且无冲突 UI、JSON 非附件二进制全量恢复、文件与数据库无 outbox 补偿、同账号跨设备计时并发窗口。

## 发现

### 1. [P2] 任务评论（`task_comment`）在彻底删除 / 清空空间 / 覆盖导入时从未清理

- 位置：
  - `src/main/java/com/devstudio/kanban/service/TaskService.java:521-529`（`deleteChildren`：清了 subtask / task_tag / time_log / attachment / task_log，**唯独没有评论**）
  - `src/main/java/com/devstudio/kanban/service/WorkspaceService.java:250-264`（`wipeData`：同上，缺评论）
  - `src/main/java/com/devstudio/kanban/service/BackupService.java:182-187`（覆盖导入的删除清单：同样缺评论）
  - `src/main/java/com/devstudio/kanban/mapper/TaskCommentMapper.java:20`、`:22`（`deleteByTaskId` / `deleteAllByWorkspace` **已定义，全项目零调用**）
  - `TaskService.java:75`、`:82`、`:94`：注入了 `commentMapper` 字段却从未使用（旁证：接线漏了）
- 触发路径：回收站自动清理（`TrashService.java:25`，每天 04:30）、`DELETE /api/tasks/{id}/purge`、删除共享空间（`WorkspaceController.java:60`）、`POST /api/import` 覆盖导入。
- 根因：任务级联删除的实现清单比表结构晚一代（评论是后加的功能），新增评论表时补了 mapper 方法但没接到三个调用点。
- 影响：
  1. 评论行成为永久孤儿数据（`sql/01_schema.sql` 中全库无任何外键/级联，不会被数据库兜底清掉），随使用时间无限增长。
  2. 与 `TaskMapper.xml:165-173` 的 `countChildRefs` 联动后更明显：该检查把 `task_comment` 计入，而 `TaskService.update/create` 会据此返回 409「该ID仍关联历史附件/日志/工时记录，不能复用」——**已彻底删除的任务 ID 被旧评论永久锁死**，既不能再新建，也无法用同 ID 的备份还原（还原时 ID 被判定空闲 → 复用 → 旧评论会自动挂到新任务上，把上一个任务的讨论内容显示给新任务）。
- 建议：三处补上 `commentMapper.deleteByTaskId(workspaceId, taskId)` / `commentMapper.deleteAllByWorkspace(workspaceId)`；`BackupService.importData` 若有意保留评论（与 task_log 同口径），请在代码注释与导入确认文案里显式写明，避免"保留"与"清空"两种理解各占一半。
- 置信度：高（方法已存在但零调用，可直接验证）。

### 2. [P3] 应用内通知（`app_notification`）同样没有任何清理入口

- 位置：`mapper/AppNotificationMapper.java:29`、`:31`（`deleteByTaskId` / `deleteAllByWorkspace` 已定义，零调用）；上述三处清理清单同样都不含它。
- 影响：任务彻底删除或空间删除后，通知中心仍保留指向已删除任务的通知；若该任务 ID 被后续导入复用，点击通知会跳到一条毫不相干的任务上。属数据残留而非功能中断。
- 建议：与发现 1 一并接线；`ref_task_id` 非空的清理可挂在 `deleteChildren`。
- 置信度：高。

### 3. [P3] 空间没有任何看板列时，看板会整体丢弃未完成任务

- 位置：`TaskService.java:139-154`。`byCol` 只装了 `configCols` + `done`；`fallbackCol = configCols.isEmpty() ? COL_BACKLOG : configCols.get(0).getId()`（`:145`），而 `COL_BACKLOG` 在 `configCols` 为空时**从未被放进 `byCol`**，于是 `byCol.get(fallbackCol)` 返回 null（`:147-153`）→ 任务被静默跳过，响应里只剩「已完成」一列。
- 触发条件：空间 `board_column` 表为空（正常路径已被 `createShared`/`createPersonal` 的 `seedColumns` 与启动兜底 `ensureDefaultsFor` 覆盖，`BoardColumnService.delete` 也拒绝删到 0 列；因此只在手工改库/异常恢复后可达）。属潜在缺陷，不是当前线上必现问题。
- 建议：`byCol.put(fallbackCol, new ArrayList<Task>())` 后再判断，或把兜底改为"找不到列就归到 `done` 之外的第一列（没有则新建/写入 backlog）"。
- 置信度：高（代码路径确定），触发概率低。

### 4. [P3] SSE 变更广播把"业务失败的请求"也当成变更广播

- 位置：`config/ChangeBroadcastFilter.java:55-58` 用 `response.getStatus()` 判断，而 `GlobalExceptionHandler.java:17-27` 对 `AppException` 返回的是 **HTTP 200 + 业务错误码**（`ApiResult` 注释即写明"HTTP 仍为 200，鉴权失败除外"）。
- 触发：任何被业务规则拒绝的写请求（如「任务ID已存在」「分类不存在」「至少保留一个管理员账号」）都会触发一次 `changed` 广播，令该空间所有在线成员各刷新一次看板/列表/项目。
- 影响：只造成多余的刷新（不产生数据错误），但在多人同时误操作时是明显的无效流量。
- 建议：在 `GlobalExceptionHandler` 成功后往 request 上写标记（如 `request.setAttribute("bizOk", true)`），或广播前解析响应体 `code == 0`。
- 置信度：高。

### 5. [P3] 成员退出或被删后，工时统计的两个口径不再自洽

- 位置：`ReviewService.java:104-128`（成员贡献的工时按 `memberMapper.selectByWorkspace` 映射显示名）与 `TimeLogMapper.xml:81-84`（`sumByWorkspace` 统计全空间工时，不区分成员是否还在）；`WorkspaceService.removeMember:307-328` 与 `UserService.delete:196-223` 都不清理 `time_log`。
- 触发：某成员退出空间（或被管理员删除账号）后打开「工作回顾」。
- 影响：「空间总工时」仍包含该成员的历史工时，但「成员贡献」列表里已没有他的行 → 成员贡献合计小于空间总工时，且差额无从解释。
- 建议：要么在成员退出时保留一条"已离开成员"归集行（按 `time_log.user_id` 聚合，显示名回落到「已离开成员」），要么在报表里显式标注"含已离场成员工时"。
- 置信度：中高（逻辑推导明确，未跑真实数据）。

### 6. [P3] `Ids.gen` 使用 `Math.random()` 生成 ID 后缀

- 位置：`common/Ids.java:14-21`。时间戳（毫秒，36 进制）+ 4 位 `Math.random()` 后缀。
- 影响：`Math.random()` 非密码学随机且可预测，同毫秒内 4 位随机后缀（约 167 万组合）在批量导入等高并发写入下存在碰撞可能，撞上就是主键冲突 500；同时用户 ID、任务 ID、空间 ID（`W`+userId）全部依赖它。
- 说明：ID 本身不承担安全职责（`sanitize` 也做了字符白名单），因此不构成越权风险。
- 建议：改用 `ThreadLocalRandom` 并加长后缀，或直接引入 UUID/ULID；`InviteService` 已正确使用 `SecureRandom`，可对齐。
- 置信度：高（代码确定），实际碰撞概率低。

### 7. [P3] `WorkspaceService.ensureDefaults` 因自调用使 `@Transactional` 失效

- 位置：`WorkspaceService.java:333-353`。`ensureDefaults()`（`@EventListener(ApplicationReadyEvent)`，方法本身无事务）在**类内部**调用 `ensureDefaultsFor(...)`，`ensureDefaultsFor` 上的 `@Transactional` 因未走代理而不生效，每个 mapper 调用各自自动提交。
- 影响：该方法是幂等的，失败后下次启动会补齐，因此只影响"异常时的原子性"，不会造成数据错误。同一模式的 `ensureDefaultsFor` 被 `BackupService.importData:256` 从外部调用时事务是生效的。
- 建议：把 `ensureDefaultsFor` 抽到独立 Bean，或在同类中改为 `AopContext`/注入自身代理，或在 `ensureDefaults` 上加事务并接受长事务。
- 置信度：高。

### 8. [P3] `TimeLogMapper` 存在完全重复且零调用的查询

- 位置：`mapper/TimeLogMapper.xml:69-73`（`sumSinceByWorkspaceUser`）与 `:101-105`（`sumSinceByWorkspaceUserFrom`）SQL 与参数完全一致；后者全项目零调用（已 grep 确认）。
- 影响：无功能影响，属死代码，容易让人误以为是两个不同口径而改错其中一处。
- 建议：删除 `sumSinceByWorkspaceUserFrom`（连同接口声明）。
- 置信度：高。

### 9. [P3] 删除看板列的审计文案写的是列 ID 而不是列名

- 位置：`BoardColumnService.java:94-95`，`activityService.logConfig(workspaceId, "删除看板列「" + c.getName() + "」，其下任务已移入「" + target + "」")`，其中 `target` 是列 ID（`:80-86`）；对照 `CategoryService.java:91-92` 用的是分类名。
- 影响：活动流里会出现「其下任务已移入「C1a2b3c4」」这类不可读文案。
- 建议：改用 `boardColumnMapper.selectById(workspaceId, target).getName()`。
- 置信度：高。

## 已检查、未发现问题的部分

- **鉴权 / 越权（IDOR）**：逐个 controller 核对了「鉴权调用次数 vs 接口数」。`workspaceService.resolve/requireMember/requireOwner` 覆盖了所有带 `workspace` 参数的接口；`resolve` 对显式 workspace 参数一律 `requireMember`（非成员返回 404，不泄露存在性）。零 `resolve` 的 controller 均为合理场景：`AdminUserController`（SecurityConfig `hasRole("ADMIN")` + 每次请求按 DB 实时角色复核）、`AuthController`（仅本人）、`MyTasksController`/`NotificationCenterController`/`SseController`（SQL 与订阅均按当前 userId 收敛）、`WorkspaceController`（服务层内校验）、`InviteController`（服务层 `requireOwner`）。任务/子任务/附件/评论/计时/保存视图的按 ID 操作都校验了 workspace 归属；`SavedViewService.delete` 还额外校验了 userId。
- **SQL 注入**：全部 17 个 mapper XML 中 `${}` 出现次数为 0，动态 SQL 均用 `#{}`；`selectMyTasks`、`AppNotificationMapper` 的 `<if>`、`TagMapper` 的 `<foreach>` 条件与空格正确，`foreach` 的三处调用点都有空集合守卫，不会生成 `IN ()`。
- **前端 XSS**：`UI.esc`（`ui.js:9-12`）转义 `& < > "`；列表/卡片/时间线/子任务/评论/标签渲染均套 `esc()`；`toast` 走 `textContent`；`showConfirm` 的 `msg` 虽用 `innerHTML`，但逐个核对 17 处调用点，用户可控内容（任务名、项目名、分类名、列名、空间名、成员名、导入文件名）全部已 `esc()`，未发现未转义拼接。附件下载的 MIME 由服务端按白名单扩展名与**服务端生成的文件名**决定，未跟随上传方声明的 Content-Type，且 `svg/html` 不在白名单内。
- **异步竞态**：第八轮的弹窗代次已修复；计时（`app.js:2557-2618` 的 `workSeq`/`workBusy`/`editingId` 三重校验）、周回顾（`reviewSeq`）、列表（`listSeq`）、看板刷新（SSE 去抖 + `drag`/`pending`/`UI.anyDialogOpen()` 守卫）、SSE 重连与心跳健康检查（`:5053-5077`）均一致。
- **认证与口令**：BCrypt 存储；`changePassword` 校验旧密码；按 UTF-8 字节数拦截 72 字节上限（避免 bcrypt 静默截断）；首启引导仅允许"完整 60 位 bcrypt 格式"直接落库，管理端建号一律按明文加密；管理员降权/删除在 `lockAdmins()` 行锁内按实时管理员列表判定，避免并发清空管理员。
- **密码/配置泄露**：`GlobalExceptionHandler` 对未捕获异常只回「服务内部错误」并记日志；非空间主的 `workspace` 对象由 `maskWebhook` 清空 webhook/token；`application.yml` 仅绑回环 + 走 nginx，凭证全部走环境变量。
- **SSRF**：`Webhooks.check` 限制 http/https、解析全部 A/AAAA 记录并拦截回环/内网/链路本地/组播/CGNAT/198.18/192.0.0；`RestTemplate` 关闭重定向跟随，超时 5s。
- **数据一致性**：`BoardQuery` 对 `doneLimit` 做了 `[1,200]` 钳制、`doneOffset >= 0`，`page()` 无 `subList` 越界；`SaveView` 参数逐字段类型校验；CSV 导出防公式注入（`= + - @` 前导加 `'`）、带 BOM；`BackupService.importData` 对 ID 做 `sanitize`+去重+跨空间重映射，分类名规范化与筛选口径一致，工时归属回落导入者。
- **计时/递归任务**：`maybeGenerateNext` 用 `setRecurNext ... AND recur_next_id IS NULL` 的条件更新做并发唯一裁决，落败方回删刚插入的行；`move()` 的"先生成后 `update`"不会误写 `recur_next_id`（`TaskMapper.xml:60-84` 的 update 语句不含该列，已逐列核对）；`minutesSince` 有 12 小时上限与最小 1 分钟。
- **DTO 校验**：14 个请求 DTO 的 `@Size/@Pattern/@NotBlank` 与 DB 列长度逐一对齐，未发现"超长值直插导致 SQL 截断 500"的缺口。

## 验证与限制

- 本轮为**纯静态阅读**：未执行 `mvn package`、未起服务、未连数据库、未跑浏览器端到端。行号基于当前工作区文件。
- 未做 MySQL 事务/锁的真实并发验证，因此发现 5、6 的并发与统计结论是基于代码推导，不是实测数据。
- 未覆盖：`static/css` 样式、`sql/02-04` 脚本本身的正确性、`deploy/` 部署脚本、`docs/*` 历史文档。
- 本轮只新增本报告，**未修改任何业务代码**。
