# 代码审查记录（2026-10-14）

审查范围：hourglass-server 的 Java 服务、控制器、MyBatis SQL、数据库迁移、浏览器端 JavaScript、部署与备份脚本；工作台根目录的旧单文件页面仅用于核对兼容性。子目录是 Git 仓库，但尚无提交，全部文件为新增暂存内容，因此审查的是完整当前版本。

结论：功能入口比较齐全，基础任务管理链路已实现；当前版本仍有两个确定的构建阻断，且空间隔离、权限撤销、备份恢复和多人协作存在重要缺口，尚不具备直接部署验收的条件。

P1 表示应优先修复的构建、权限、数据丢失或核心协作问题；P2 表示功能边界、流程与统计问题。以下除构建问题实际执行验证外，均为根据调用链和 SQL 确认的静态审查结论，未在真实数据库中执行破坏性复现。

## 优先修复的问题

### 1. [P1] MySQL 驱动依赖导致 Maven 无法构建

位置：`pom.xml:43`。

父版本为 Spring Boot 2.7.18，但依赖仍使用不再由该版本管理版本号的 `mysql:mysql-connector-java`，且未指定版本。原项目执行 `mvn -o -DskipTests package` 直接报 dependency.version is missing。建议改用受管理的 `com.mysql:mysql-connector-j`，或明确使用兼容的驱动版本。

### 2. [P1] 附件缩略图回退分支存在 Java 编译错误

位置：`src/main/java/com/hourglass/kanban/controller/AttachmentController.java:101,139`。

`thumb()` 声明 `ResponseEntity<byte[]>`，但回退调用 `download()` 返回 `ResponseEntity<Resource>`，两者不能赋值。临时副本中修正依赖后，编译器确实在第 139 行报错。建议将接口响应类型统一为适当的共同类型，或使两个分支采用一致的响应体类型。

### 3. [P1] 文档给出的旧库升级顺序无法完成管理员初始化

位置：`deploy/README.md:31-40`、`sql/02_multi_user.sql:6`、`src/main/resources/mapper/UserMapper.xml:34`、`src/main/java/com/hourglass/kanban/service/UserService.java:81,182`。

文档要求先执行 02，再启动当前新版程序生成管理员，再回填并执行 03。但执行 02 后 app_user 只有 notify_webhook，没有新版 INSERT 必须使用的 last_workspace_id；workspace 表也尚不存在。启动程序的 bootstrapAdmin 会失败并吞掉异常，无法按文档生成管理员，后续回填失去归属依据。应提供与过渡表结构匹配的初始化 SQL/迁移程序，或指定确实兼容该结构的过渡版本，不能使用当前空间版程序执行中间步骤。

首次引导调用 private createAccount 本身也没有覆盖用户和空间创建的统一事务：如果用户 INSERT 成功、空间创建失败，重启会因为 countAll > 0 跳过引导，留下没有个人空间的账号。应一并保证初始化原子性或补偿修复。

### 4. [P1] 管理员降权或删除后，旧登录会话仍可调用管理员接口

位置：`src/main/java/com/hourglass/kanban/common/LoginUser.java:18-24`、`src/main/java/com/hourglass/kanban/config/SecurityConfig.java:32`、`src/main/java/com/hourglass/kanban/service/UserService.java:124,176`。

管理员权限在登录时固定为 session 中的 ROLE_ADMIN。更新角色、删除账号均未失效或刷新旧会话，接口鉴权继续相信旧权限；/auth/me 也返回旧主体中的 role。被降权或删除的管理员在会话到期前仍能管理其他账号。应主动撤销受影响的会话，或请求时验证账号存在性及权限版本。重置密码保留旧会话是代码明确写出的行为，也应根据实际密码重置用途重新确认。

### 5. [P1] 个人空间可以被邀请其他用户进入

位置：`src/main/java/com/hourglass/kanban/service/WorkspaceService.java:236`。

addMember 只验证空间主，没有验证 type=shared。个人空间主可直接 POST /api/workspaces/{个人空间ID}/members 添加任意现有账号，受邀者随后能读写该个人空间数据，违反个人空间与共享空间的模型。同时 removeMember 对 personal 一律拒绝，空间主无法撤销这次邀请，且个人空间也不可删除。必须在添加成员时拒绝个人空间，并处理已产生的非法成员关系。

### 6. [P1] 显式指定的无权限空间被静默替换为个人空间

位置：`src/main/java/com/hourglass/kanban/service/WorkspaceService.java:87-101`。

resolve 对“没传 workspace”和“明确传了不存在/已无权限的 workspace”采用同一种回退。共享空间删除或成员被移除后，旧页面提交新任务会落入个人空间；旧页面的空间主调用覆盖导入时，也可能清空个人空间而不是得到权限错误。显式 workspace 必须严格 requireMember，只有参数缺省时才可从上次空间回退。

### 7. [P1] JSON 备份无法完整恢复，导出后再导入也会丢数据

位置：`src/main/java/com/hourglass/kanban/dto/BackupData.java:13-37`、`src/main/java/com/hourglass/kanban/service/BackupService.java:85-176,470`。

备份没有附件文件/元数据、任务操作日志、回收站任务、自定义列定义和分类配色，也没有任务创建时间。覆盖导入却删除整个空间的任务、日志和附件，包括未被导出的回收站内容。同空间原样导回也会永久删除所有附件与时间线；跨空间导入自定义列因没有列定义被 mapColumn 降为 backlog；任务创建时间变为导入时间，历史新增趋势失真。应实现完整备份恢复格式，或明确标注为“部分任务数据导出”，禁止把它当作完整恢复保障，并在覆盖前提示具体丢失范围。

### 8. [P1] 导入失败回滚数据库，仍会永久丢失磁盘附件

位置：`src/main/java/com/hourglass/kanban/service/BackupService.java:161-176`、`src/main/java/com/hourglass/kanban/service/AttachmentService.java:122-126`。

覆盖导入开始时先物理删除附件，然后执行大量数据插入。如果后续数据库写入失败，事务会恢复旧附件记录，但文件已被删除，恢复后的任务只剩失效附件链接。普通附件删除和空间删除也存在类似的文件/数据库一致性边界。建议校验完整输入后再修改数据，并通过事务提交后的删除、临时隔离文件或可靠补偿机制处理磁盘变更。

### 9. [P2] 自定义附件目录后，自动备份会漏掉附件

位置：`src/main/resources/application.yml:49`、`deploy/hourglass.service:10`、`deploy/backup.sh:7,19-20`。

应用默认 ATTACH_DIR=./data/attachments，systemd 工作目录是 /opt/hourglass；应用与备份脚本在默认部署下都使用 /opt/hourglass/data/attachments。但用户覆盖 ATTACH_DIR 后，脚本仍硬编码默认路径，且目录不存在时静默跳过。实际附件目录没有备份，脚本仍可输出 backup ok。应让备份脚本与应用共用目录配置，并显式验证附件目录存在。

### 10. [P1] 多人编辑和循环任务完成没有并发保护

位置：`src/main/java/com/hourglass/kanban/service/TaskService.java:300-333,343-388`、`src/main/resources/mapper/TaskMapper.xml:33-51`。

编辑和移动均先读完整任务，再无版本检查地覆盖写入所有字段。A 改标题、B 用旧数据移动任务，会把 A 的标题覆盖回去；两个客户端同时完成同一个循环任务，都可能读到未完成状态并各生成下一次任务。@Transactional 不会自动阻止这种竞争。应增加版本号/条件更新并反馈冲突，循环完成需要锁定原任务或保证下一次生成的幂等性。

## 功能流程与边界问题

### 11. [P2] 工时计时按整个共享空间互相抢占，且并发开始可产生重复计时

位置：`src/main/java/com/hourglass/kanban/service/TimeLogService.java:47-62`、`src/main/resources/mapper/TimeLogMapper.xml:5-21`、`sql/01_schema.sql` 的 time_log 表。

A 在共享空间任务甲开始计时，B 在任务乙开始计时会自动停止 A 的计时，因为停止范围为整个 workspace，而记录没有计时人。若计时表示个人工时，这个模型不能支撑多人协作。另一个独立问题是先检查再 INSERT 没有锁或唯一约束，两个请求可同时启动同一任务，停止时再一起关闭并造成工时重复。应明确个人/任务/空间计时的产品规则，并建立相应数据归属和并发约束。

### 12. [P2] 删除项目或列后，回收站任务恢复出悬空关联

位置：`src/main/resources/mapper/TaskMapper.xml:102-104`、`src/main/resources/mapper/BoardColumnMapper.xml:38-40`、`src/main/java/com/hourglass/kanban/service/TaskService.java:416`。

解除项目关联和迁移删除列内任务都排除了 deleted_at 非空的任务。先将任务放入回收站，再删除其项目/自定义列，再恢复任务，任务仍保留已经不存在的 req_id/board_column。看板虽把未知列展示在兜底列，真实字段仍然失效，表单与筛选也不一致。应同步维护回收站关联，或恢复时校验并修复。

### 13. [P2] 提醒超过六小时后会永久漏发

位置：`src/main/java/com/hourglass/kanban/service/NotificationService.java:40,90`、`src/main/resources/mapper/TaskMapper.xml:77-87`。

扫描只查询最近六小时内的到期提醒。停机、渠道故障或未配置 webhook 超过六小时后，即使服务和渠道恢复，仍未发送的旧提醒也永远不会被选中，没有过期状态反馈。应提供补发/过期处理规则，而不是让未发送提醒静默挂起。

### 14. [P2] 加载更多已完成任务后，实时同步与轮询持续停止

位置：`src/main/resources/static/js/app.js:1666,1674,2789`。

只要 doneExtra 非空，SSE、定时轮询和页面重新可见时刷新都直接返回。点击一次“加载更多”后，即便页面空闲，也长期看不到其他设备的修改，直到另一个动作触发 loadBoard 或整页刷新。弹窗打开期间丢弃的事件也没有待刷新标记。应保留分页状态并合并刷新，或关闭弹窗/结束交互后补做刷新。

### 15. [P2] 无截止日期的完成任务被统计为延期

位置：`src/main/java/com/hourglass/kanban/service/ReviewService.java:65-75`。

onTime 只计算有截止日期且按期完成的任务，late 却计算 done-onTime。因此一个没有截止日期的完成任务会直接记为延期，并降低按期率。应区分按期、延期和未设置截止日期，按期率分母也应采用明确的统计口径。

### 16. [P2] 文档承诺可配置 bcrypt 哈希，实际会再次加密哈希

位置：`deploy/README.md:59`、`src/main/resources/application.yml:41`、`src/main/java/com/hourglass/kanban/service/UserService.java:187`。

配置说明允许 AUTH_PASSWORD 使用 bcrypt 哈希，但 createAccount 对所有字符串都调用 encoder.encode。提供哈希后，数据库保存的是哈希字符串的二次 bcrypt，原密码无法登录。应明确区分首次引导的已编码密码与管理员创建的原始密码，或删除不受支持的配置承诺。

### 17. [P2] 自动清理失效筛选条件后，结果未重新查询

位置：`src/main/resources/static/js/app.js:301-308,3298`。

loadBoard 使用旧条件查询后，pruneStaleFilters 才修改本地 state，之后直接 render 旧响应。例如选中分类后，另一成员重命名该分类，页面提示筛选已清理，却仍显示使用旧分类筛选出的空结果，直到下一次刷新才恢复。应在条件变化时重新查询，或先校验筛选条件再获取结果。

### 18. [P2] 列和分类排序接口允许重复 ID

位置：`src/main/java/com/hourglass/kanban/service/BoardColumnService.java:98`、`src/main/java/com/hourglass/kanban/service/CategoryService.java:96`。

校验仅检查列表长度与 known.containsAll(ids)。现有 [A,B,C] 时，提交 [A,A,B] 同样通过，A 被更新两次，C 完全没更新，形成不完整排序。应检查输入无重复，且输入集合与现有集合相等。

## 验证记录与建议顺序

- 原项目离线 Maven 打包：失败，确认 MySQL 依赖版本缺失。
- 在系统临时目录建立源码副本，只替换驱动坐标：编译失败，确认 AttachmentController 第 139 行泛型返回类型错误。
- 临时副本再将 thumb 响应类型调整为 ResponseEntity<?>：离线 Maven package 成功。该结果仅证明这两处修正后可以编译打包，不代表运行时与业务验收通过。
- app.js、api.js、sw.js 的 Node 语法检查通过。
- 未发现 src/test 测试代码，未连接真实 MySQL，未启动服务或执行浏览器端到端验收，也未执行数据导入/删除。
- 原业务源码、SQL 和配置未修改；本文件为新增审查产物。

建议顺序：修复构建 → 修复空间隔离和权限撤销 → 重做迁移/备份恢复校验 → 加并发保护 → 修正计时、回收站、提醒、同步与统计。首轮验收应覆盖两个用户、两个空间、两个同时在线客户端，以及导入失败和恢复场景。
