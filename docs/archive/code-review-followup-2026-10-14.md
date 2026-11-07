# 修改后复审（2026-10-14）

本轮按当前源码与 docs/api.md、deploy/README.md 审查。仓库仍无历史提交，无法通过提交差异严格判定全部问题的引入时间；标为“新增”的问题由本次明确新增的数据归属、导入保留或迁移逻辑产生，标为“遗留”的问题在上轮源码中已经存在。

明确遵守用户保留范围：不要求会话注册表/踢线、不要求任务乐观锁与冲突 UI、不要求 JSON 包含附件二进制或全量恢复格式、不要求 outbox 补偿。以下问题可以在现有设计范围内修正；不会以这四项缺失为整改理由。

## 1. [P1，新增] 保留附件/日志但释放任务 ID，导致跨空间泄露和误删除

位置：BackupService.java:177；TaskService.java:254；AttachmentMapper.xml:10,31；TaskLogMapper.xml:15,21；AttachmentService.java:113。

覆盖导入（包括前端清空）删除任务，但保留附件与日志。任务 ID 因而重新可用，TaskService.create 只查 task 表判断占用。附件与日志查询/删除却只按 task_id，不按 workspace_id。

可复现路径：空间 A 的任务 K 带附件与日志 → A 清空任务 → 空间 B 创建指定 ID=K 的任务 → B 请求该任务日志，会收到 A 的旧日志；附件列表也泄露 A 的文件名、附件 ID 等元数据。附件下载自身还有空间检查，因此不能直接据此断言 B 能下载 A 的文件；但 B 将 K 放入回收站并彻底删除时，deleteByTask 不使用传入的 workspaceId，会物理删除 A 的文件并删除 A 的附件和日志记录。

同一空间复用旧 ID 也会把旧任务附件/日志误挂到新任务上。修复应让所有子表查询/删除均使用空间与任务联合条件，并对保留子记录的任务 ID 建立占用或明确重关联规则。无需增加附件二进制格式或 outbox。

## 2. [P1，新增] 旧库迁移先删除列记录，回填永远不会执行到原列

位置：sql/03_finalize_legacy.sql:61-62。

脚本先执行 DELETE FROM board_column WHERE workspace_id=''，紧接着才 UPDATE 同样 workspace_id='' 且 user_id 非空的行。02 为旧列新增 workspace_id 时默认就是空，所以多用户旧库的列配置，包括自定义列、名称、颜色、排序，全部先被删除。旧任务仍保留原自定义列 ID，迁移后落入未知列的显示兜底，编辑时也可能得到列不存在错误。

应先按 user_id 回填，再单独处理真正的全局种子行，保留自定义列及任务归属；清理种子不能以所有 workspace_id 空行作为条件。

## 3. [P1，新增] 迁移脚本并非幂等，单用户旧库还有缺列与执行顺序阻断

位置：sql/03_finalize_legacy.sql:39,66,93,111；sql/02_upgrade_from_legacy.sql:244-245。

- 03 成功执行后会删除 task.user_id 等旧列。单独再次执行 03 时，第 39 行直接引用已不存在的 user_id，立即失败；后续 board_column.user_id 和 app_user.notify_webhook 同样不具备存在性保护。
- 02 没有为新建的 app_user 或不含该字段的旧 app_user 补 notify_webhook，但 03 无条件读取 u.notify_webhook。单用户旧库在该步骤报 Unknown column，并停留在部分迁移状态。再次执行整个 02→03 也不会解决这个缺列。
- saved_view 的 workspace_id 使用 AFTER user_id 添加，但 user_id 是下一条 CALL 才补的。旧单用户 saved_view 若没有 user_id，会在 02 提前失败。

应根据 information_schema 动态执行所有涉及可选旧列的 SQL，并先补作为 AFTER 参照的字段。仅给 DROP 包装存在性判断不足以让整个脚本幂等。DDL 有自动提交特性，不能假定脚本失败会恢复已完成的删除或结构变更。

## 4. [P1，新增归属逻辑未闭环] 个人计时仍按任务查询与停止

位置：TimeLogService.java:34-78；TimeLogMapper.xml:9,35；TimerController.java:29。

新增的 user_id 只用于记录与查找“自己的其他计时”。status、start 的正在运行检查、stop 都使用 selectRunningByTaskId，停止 SQL 也只限定 task_id。

A 对任务甲开始计时后，B 打开同一任务会看到 A 的运行状态；B 开始计时不创建自己的记录，B 停止则结束 A 的计时。B 原来正在任务乙计时的话，B 点击开始甲还会绕过停止自己乙的逻辑。这与 api.md 中“按人计时、不影响他人”不一致。

应区分“当前人的计时状态/停止”和“任务完成或删除时停止全部成员计时”，前者按 task_id+user_id，后者按任务整体。另有遗留竞争：开始计时依然是无锁的先查后插，跨设备同账号可以同时插入多个运行记录；新增 idx_user_timer 是普通索引，不能保证文档中的跨空间唯一。

## 5. [P2，新增] 原样导出再导入，把所有人的工时归给导入者

位置：BackupService.java:107-116,395-407；BackupData.java 的 BackupTimeLog；StatsService.java 的按人汇总。

导出包含整个空间的已完成工时，却不保存计时人的 user_id；导入删除全部工时，再把每条记录都写为当前导入用户。共享空间 A 工作 60 分钟、B 工作 30 分钟，空间主 A 原样导回后，报表变成 A=90、B=0。不是附件全量恢复问题，而是已支持的工时数据在本轮新增个人统计下失真。

应保存并校验计时人；同空间恢复保留合法归属，跨空间导入对不在目标空间的用户采用明确规则，不能将所有工时静默变为导入者的劳动记录。

## 6. [P1，新增] 备份脚本把 systemd 环境文件当作 Bash 脚本，合法配置可使备份失败

位置：deploy/backup.sh:3,11-16；deploy/README.md 的 AUTH_PASSWORD 与 NOTIFY_CRON 示例。

脚本启用 set -euo pipefail 后直接 source /etc/devstudio.env。但 systemd EnvironmentFile 与 shell 不是相同语法。文档允许未加引号的 bcrypt AUTH_PASSWORD=$2a$...，Bash 会展开 $2；没有第二个位置参数时 set -u 导致脚本在开始备份前退出。有效的 systemd 配置 NOTIFY_CRON=0 0 9 * * *，在 Bash 中也会尝试执行命令 0，导致退出。

应按环境文件格式安全提取备份实际需要的 DB_NAME/ATTACH_DIR，或维护格式明确的共享配置，并同步更新文档；不要执行整份应用环境文件。另一个遗留问题：tar 失败被 2>/dev/null || true 吞掉，下一行仍输出 attachments ok，需以真实退出状态判定成功。

## 7. [P1，遗留漏检] 从日历编辑任务会清空其标签

位置：TaskService.java:224-245；app.js:1049,1123,1822,1913；TaskService.java 的 saveTags。

calendar 返回 taskMapper.selectAll 的原始任务，没有像看板/列表一样 mergeTaskExtras，所以 tags 为 null。日历点击任务把该对象直接交给 openTaskForm，标签输入框被设为空；只改标题后保存，提交 tags=[]，saveTags 删除原标签关联。正常 UI 操作会静默丢标签，和用户接受的并发覆盖口径无关。

应给日历任务补齐标签，或在打开编辑表单时读取完整任务对象，确保所有编辑入口使用同一字段集合。

## 8. [P2，本次同步修复扩大触发范围] 迟到的分页响应污染新筛选结果

位置：app.js:335-355,3322-3334。

loadBoard 用 loadSeq 丢弃过期响应，loadMoreDone 没有对应校验。请求旧筛选下的下一页后，切换筛选或触发后台刷新，新的 state.board 已经替换；旧分页响应回来仍向当前 state.doneExtra 插入旧任务，修改捕获的旧 cd，并重新 render。

本轮新 refreshBoardPreserving 会自动发起分页请求，使该窗口更容易发生。已用当前 loadMoreDone 函数和可控制响应顺序的 Node 探针实测：新首项为 new-first 的看板在旧分页响应后出现 extra=[stale-task]。

应对分页请求携带看板版本/筛选快照，仅在响应仍属于当前看板时合并，并取消或失效旧的自动补页循环。补页失败当前 catch 会吞错并让 step 继续，最多反复请求 11 次，也应让失败终止。

## 9. [P2，新增] 导入列定义绕过保留 ID 与字段约束

位置：BackupService.java:260-276；TaskService.java:98-118；TaskSaveRequest.java 的 boardColumn。

导入列定义使用 Ids.sanitize，允许最长 32 字符，数据库列 ID 与任务保存校验却只有 16。更关键的是，没有排除保留 ID=done：导入 columns=[{id:"done",name:"测试"}] 会把 done 真正写入 board_column，而正常代码只把它当系统虚拟列。看板返回重复 done 列定义；前端会渲染重复列，各种设置也把系统完成列当成用户配置列。超长 ID 则导致整次导入数据库写入失败。

应复用正常列创建的长度与保留值规则，在写入前统一校验。不能仅用通用任务 ID 清洗函数替代列定义校验。

## 10. [P2，新增] bcrypt 前缀判断影响管理员正常创建账号

位置：UserService.java:116,199-202；UserCreateRequest.java 的 password。

为支持首次引导哈希，通用 createAccount 对所有以 $2a$/$2b$/$2y$ 开头的字符串都直接当哈希保存，包括管理员账号创建接口。合法的明文密码 `$2a$abcdef` 满足 6-64 位校验，却被写成无效 bcrypt；创建成功但用户无法用该密码登录。相同密码经重置接口则正常被加密，行为不一致。

应将“允许已编码哈希”限定在环境变量引导入口，并校验完整哈希格式；管理员创建账号始终按明文加密。

## 11. [P2，修复未覆盖所有空间] 无 webhook 空间的过期提醒仍永久静默挂起

位置：NotificationService.java:88-110；WorkspaceMapper.xml 的 selectWithWebhook。

过期处理被放在 selectWithWebhook 的循环内。启用了提醒但空间尚未配置 webhook，或期间删除了 webhook，该空间的提醒不参与过期扫描，仍保持 remind_sent=false，也没有时间线说明；这与 api.md 的“超过六小时会标记并记录”承诺不符。应让过期处理覆盖全部空间，发送逻辑才按渠道配置筛选。

## 文档口径核对

- api.md 仍写“无截止日期的完成项计入延期”，但 ReviewService 已改为 withDue-onTime，前端总结也使用 withDue。此处应更新文档，与代码采用相同口径。
- 当前可见 api.md 只明确写了“重置密码不踢线”；没有说明角色变更/删除后的旧权限行为，也未找到任务最后写入覆盖、文件/数据库无补偿的一致性说明。按用户要求本轮不把这些实现列为整改项，但若要作为已接受的现状口径，文档需要分别写清楚，不能让“重置密码不踢线”代替其他行为解释。
- JSON 保留附件和日志的约定本身按用户要求接受；第 1 项是其与 ID 重用、子表缺少空间过滤产生的新问题，不要求扩展全量格式。

## 修复确认和验证边界

已确认原源码 mvn -o -DskipTests package 成功（99 个 Java 源文件），不再需要临时修正两处构建错误；app.js/api.js/sw.js 的 Node 语法检查均通过。

静态核对确认：个人空间新增成员已拒绝；显式无权限 workspace 已严格校验；列/项目删除已同步维护回收站任务；重复排序 ID 已拒绝；失效筛选清理后已重新查询；任务 createdAt 已支持恢复；导入不再物理删除附件；周回顾已调整无截止日期的统计口径。这些修复方向有效。

本轮没有连接真实 MySQL，没有执行生产数据迁移/导入，没有运行真实浏览器端到端测试。迁移、权限与数据关联结论来自源码及 SQL 调用链；分页竞态用提取自当前源码的函数进行了受控执行验证。没有修改业务源码、配置或 SQL，仅新增本审查记录，Maven 产生了 target 构建产物。

建议先修 1/2/3/6/7，再完成个人计时与工时恢复归属，最后处理分页、导入字段校验及文档一致性。
