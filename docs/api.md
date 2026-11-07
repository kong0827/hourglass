# 开发工坊 · 接口清单（步骤 2 验收用）

基准地址：`http://<服务器地址>:8080`（部署后走 nginx 时换成对外地址）

## 统一返回约定

- 成功：`{"code": 0, "message": "ok", "data": ...}`
- 业务错误：HTTP 200，`code` 非 0（400 参数问题 / 404 不存在 / 409 冲突 / 500 内部错误），`message` 为中文提示
- 校验失败：`code=400`，`message` 为具体字段提示（如「请填写任务标题」）

## 认证

除 `/api/health` 外所有接口需要登录态（会话 Cookie，有效期 30 天）：

- `POST /api/auth/login`（表单参数 `username`、`password`）→ 成功 `{"code":0,"message":"ok"}`，失败 HTTP 200 + `{"code":401,"message":"用户名或密码错误"}`
- `POST /api/auth/logout` → 退出登录
- `POST /api/auth/password`（body `{"oldPassword":"...","newPassword":"..."}`）→ 修改自己的密码（校验旧密码）
- 会话说明：登录状态 30 天有效；**管理员重置密码后，该用户已登录的会话保持有效直到过期**（无会话注册表，不会踢线）
- 未登录访问接口返回 HTTP 401 + `{"code":401,...}`；页面访问未登录跳转 `/login.html`
- 写操作（POST/PUT/DELETE）需携带 CSRF 头 `X-XSRF-TOKEN`（值取自 Cookie `XSRF-TOKEN`，前端已封装自动处理；Apifox 调试时先 GET 一次任意接口拿到 Cookie）

## 多用户与空间

- 账号由管理员创建下发（不开放注册）；共享空间可生成邀请链接，把**已有账号**拉入空间协作；管理员只管账号
- **空间模型**：每个账号自动有一个「我的看板」个人空间；任何人可新建共享空间并当空间主，成员**只能通过邀请链接加入**（对方打开链接并确认后才成为成员）；`POST /api/workspaces/{id}/members` 按登录名直接加人**仅平台管理员可用**，普通空间主调用返回 403，避免不经同意就把人拉进空间
- 所有业务接口都接受 `workspace` 查询参数（空间ID）；不传时用"上次使用的空间"，再退回个人空间。前端切换空间后自动携带
- **数据按空间隔离**：任务/子任务/项目/附件/工时/操作日志/标签/看板列/分类属于空间；保存的筛选视图属于"人+空间"
- **权限**：全员可做日常操作（增改删任务、拖拽、子任务、标签、计时、附件、回收站恢复）；**仅空间主**可做：改空间名/推送配置、移成员、生成/撤销邀请、删空间、删看板列、删分类、清空任务数据、导入覆盖。跨空间访问一律 404，权限不足返回 403
- **审计**：操作时间线记录操作人（`actorName`），历史数据显示为空
- 账号接口：
  - `GET /api/auth/me` → `{id, username, displayName, role, lastWorkspaceId, workStartHour, workEndHour, workMaxHours}`
  - `PUT /api/auth/work-hours`，body `{"startHour":9,"endHour":18,"maxHours":8}` → 修改自己的计时设置（`0 ≤ startHour ≤ 23`、`1 ≤ endHour ≤ 24`、`endHour > startHour`、`1 ≤ maxHours ≤ 24`）；只影响之后的计时折算，已记录工时不重算
  - `PUT /api/auth/profile`，body `{"displayName":"..."}` → 修改自己的显示名（负责人默认值与成员列表随之更新；**其参与空间中「负责人=旧显示名」的任务同步改为新名**，含回收站任务；操作时间线保留历史记录）
  - 管理员专属（`/api/admin/users`，见下方原章节）：新增/改显示名与角色/重置密码/删除（需先清空其个人空间数据、非共享空间主、不能删自己、至少留一名管理员）
- 空间接口：
  - `GET /api/workspaces` → 我参与的空间（含 `type` personal/shared、`myRole`、`memberCount`）
  - `POST /api/workspaces`，body `{"name":"项目组看板"}` → 新建共享空间（创建者为空间主）
  - `POST /api/workspaces/{id}/select` → 记住"上次使用的空间"
  - `PUT /api/workspaces/{id}`，body 可按需提交 `{"name":"..."}` 或推送字段（仅空间主；个人空间名称不可改）。PATCH 语义：`name` 不传=保持原值；`notifyChannel`/`notifyEnabled` 不传=保持原值；`notifyWebhook` 不传=保持原值、传空串=清除；`notifyToken` 留空=保持原值，`clearToken:true` 才清除已保存 Token
  - `DELETE /api/workspaces/{id}`（仅空间主，连带全部数据，不可恢复；个人空间不可删）
  - `GET /api/workspaces/{id}/members` → 成员（含显示名/登录名/角色）
  - `POST /api/workspaces/{id}/members`，body `{"username":"xiaoming"}`（仅空间主）
  - `DELETE /api/workspaces/{id}/members/{userId}` → 空间主移除成员；成员自己调用即退出；空间主不能退出自己的空间（可直接删空间）
  - 邀请链接（共享空间协作入口，见 §29）：`POST/GET /api/workspaces/{id}/invites`、`DELETE /api/workspaces/{id}/invites/{inviteId}`（均仅空间主）
- 分类接口（每个空间一套，可增删改色，默认种子「工作/学习/生活/其他」）：
  - `GET /api/categories` → `[{id,name,color,sortOrder}]`
  - `POST /api/categories`，body `{"name":"客户跟进","color":"#7a5c86"}`
  - `PUT /api/categories/{id}`（改名会同步历史任务上的分类名）
  - `DELETE /api/categories/{id}`（仅空间主；其下任务改到第一个分类，至少保留一个）
  - `PUT /api/categories/order`，body `{"ids":[...]}`
- 优先级显示配置（每空间固定 P0/P1/P2/P3 四档，只改显示名与颜色，不改变存储、筛选、排序和导出 code）：
  - `GET /api/priorities` → 固定顺序返回四档 `[{workspaceId,code,name,color,...}]`；未配置的档位返回内置默认「紧急/高/中/低」，不写库
  - `PUT /api/priorities/{code}`，body `{"name":"高","color":"#F79009"}` → 修改单档显示配置；查看者 403
  - `DELETE /api/priorities` → 清除当前空间的自定义配置，四档全部恢复内置默认；查看者 403
- 任务保存的 `category` 必须是当前空间已有分类；不传则落在第一个分类（迁移数据自动保留原分类名与配色）

## 通用查询参数（看板 / 已完成列表）

| 参数 | 说明 |
|---|---|
| q | 关键词，匹配标题/描述/进度备注（不区分大小写） |
| owners / pris / cats / reqs / tags | 逗号分隔多选；pris 取值 P0,P1,P2,P3；reqs 支持特殊值 `__none`（未归类）；tags 为标签名 |
| due | 截止维度：over（逾期）/ today（今天）/ soon（3 天内，含今天） |
| focus | true = 今日聚焦（逾期 + 今天到期 + 进行中的 P0） |
| doneScope | 已完成列范围：week（默认，本周）/ all |
| doneLimit / doneOffset | 分页，默认 20 / 0，limit 上限 200 |

---

## 1. GET /api/health

应用 + 数据库连通检查。

```json
{"code":0,"data":{"app":"hourglass","time":"2026-10-14 21:00:00","db":"up"}}
```

## 2. GET /api/board

看板聚合：三列数据、提醒计数、筛选元数据（负责人/优先级/分类/项目计数）。完成列返回第一页。

```json
{"code":0,"data":{
  "columns":{
    "backlog":{"items":[],"matched":0,"total":0,"allTotal":0,"hasMore":false},
    "doing":{"items":[],"matched":0,"total":0,"allTotal":0,"hasMore":false},
    "done":{"items":[],"matched":0,"total":0,"allTotal":12,"hasMore":false}
  },
  "counts":{"over":0,"today":1,"soon":2},
  "meta":{"owners":[{"name":"我","count":9}],"pris":[{"name":"P0","count":1}],
          "cats":[],"reqs":[{"id":"R...","name":"资金小程序","status":"active","count":3}],"unassigned":4}
}}
```

`matched`=筛选后条数；`total`=筛选前当前范围内条数；`allTotal`=全部历史条数（「仅本周 ⇄」提示用）。

## 3. GET /api/tasks/done

已完成列「加载更多」。参数同上（含 doneOffset）。响应为单个列对象：`{"items":[...],"matched":40,"total":40,"allTotal":40,"hasMore":true}`。

## 4. POST /api/tasks

新增任务。`id` 选填（撤销删除/导入时指定），不填服务端生成。

```json
{"title":"重构权限校验中间件","description":"","priority":"P1","category":"后端",
 "boardColumn":"doing","dueDate":"2026-10-20","reqId":"Rxxx","progress":40,"note":"已确权方案"}
```

`dueDate` 格式 `yyyy-MM-dd`；`progress` 0-100；返回创建后的完整任务对象。撤销删除恢复时可在 body 中带 `completedAt`（yyyy-MM-dd）保留原完成日期、带 `subtasks: [{title, done}]` 一并重建检查清单。ID 只接受字母/数字/下划线/中划线（≤32 位），不合法会当作未提供重新生成；指定 ID 已被占用的返回 409；覆盖导入会保留附件/日志等子记录，指定这类"仍有历史子记录"的 ID 同样返回 409，防止旧记录误挂到新任务。

## 5. PUT /api/tasks/{id}

全量更新任务字段（与新增同结构，title 必填）。列变更时自动处理完成日期，并**同时写入一条 `action=move` 的移动日志**（流程体检据此统计）；其他字段变更写 `action=update`。

## 6. POST /api/tasks/{id}/move

拖拽移动。

```json
{"column":"done","beforeId":"Kxxx"}
```

`beforeId` 为空字符串/不传 = 移到列尾；同列内也用它调整顺序。`autoTimer=false` 时移入非待处理/非完成列不自动计时；`autoResume=false` 时移到已完成不自动接力下一条。返回：

```json
{"code":0,"data":{"task":{...},"from":"doing","to":"done","autoTimerStarted":false,"autoTimerTask":null}}
```

同列内移动（只调顺序）不会把停留时长切成碎段。

### 6.1 POST /api/tasks/bulk-move

列表页批量改列，body `{"ids":["K1","K2"],"column":"done","autoTimer":false,"autoResume":false}`。逐项走 move 语义（移动日志、完成归档、循环派生一致）；批量默认不自动开始/接力计时。最多 500 项，任一项失败整批回滚。

### 6.2 POST /api/tasks/{id}/reopen

取消完成：按最近一次移入 done 的 `from_column` 回到**完成前所在列**；该列已删除时依次回退到 `doing`、第一个非完成列、`backlog`。不自动开始计时。返回结构同 move。

## 7. DELETE /api/tasks/{id}

删除任务：软删除进回收站（30 天自动清理）；撤销/恢复用 `POST /api/tasks/{id}/restore`，详见第 20 节。

## 8. GET /api/tasks/{id}/logs

任务时间线，倒序最多 200 条：

```json
{"code":0,"data":[{"id":12,"taskId":"Kxxx","action":"move","detail":"从「进行中」移动到「已完成」","createdAt":"2026-10-14T21:00:00"}]}
```

## 9. GET /api/reqs

项目列表（含任务数/完成数/平均进度/需求文档数）：

```json
{"code":0,"data":[{"id":"Rxxx","name":"资金上场小程序","description":"","status":"active",
  "progressPct":45,"taskCount":4,"doneCount":1,"docCount":2}]}
```

## 10. POST /api/reqs

新增项目：`{"name":"资金上场小程序","description":"","status":"active"}`（status: active/done/hold）。

## 11. PUT /api/reqs/{id}

更新项目，结构同新增。

## 12. DELETE /api/reqs/{id}

删除项目：其下任务保留、仅解除关联；其下**需求文档会一并删除**（同时清理任务上的 `reqDocId`）。返回：

```json
{"unlinked": 3, "docs": 2}
```

## 13. GET /api/review?weekOffset=-1

工作回顾。`weekOffset` 不传时自动选最近一个有完成记录的周；0=本周，-1=上周。返回：

```json
{"code":0,"data":{
  "weekOffset":-1,"weekStart":"2026-10-06","weekEnd":"2026-10-12","label":"上周",
  "completed":[{...任务}],
  "stats":{"done":5,"withDue":5,"onTime":4,"onTimeRate":80,"members":1,"late":1},
  "members":[{"name":"我","count":5}],
  "catDist":[{"name":"后端","count":3}],
  "progressTasks":[{...}],
  "reqDist":[{...同 /api/reqs}],
  "counts":{"over":1,"today":0,"soon":2},
  "openP0":2,"doing":3,"backlog":5
}}
```

完成率口径：按期率分母为「设置有截止日期的完成项」（withDue）；无截止日期的完成项既不计入按期也不计入延期（`late = withDue - onTime`）。

## 14. GET /api/export

导出当前空间的**任务备份**（v6）。结构与旧版前端 `devstudio-kanban-backup.json` **兼容（超集）**：包含 tasks/reqs/columns；v4 起额外包含任务评论（comments）、任务 `deletedAt`（回收站）与任务的 `reqDocId`/`branchId`/`estimateMinutes`/`blocked`/`blockedReason`/`ownerUserId`/`remindTarget` 字段；v5 起额外包含任务 `isMilestone`、甘特依赖（`deps`）、基线（`baseline` + `baselineAt`）；v6 起额外包含 `reqDocs`（需求文档，含正文）与 `branches`（分支池，不含分支操作时间线）。旧版页面仍可直接导入读取；本系统导入旧备份时按备份里出现的分类名自动补齐分类表（旧四类保留原配色）。

**不含**：附件文件、操作时间线、保存视图、分类/看板列设置。

## 15. POST /api/import

导入任务备份文件，覆盖当前数据：

```json
{"v":6,"tasks":[{"id":"Kxxx","title":"...","desc":"...","pri":"P1","owner":"我","cat":"后端",
  "col":"doing","due":"2026-10-20","progress":40,"note":"","reqId":"Rxxx","reqDocId":"Dxxx",
  "branchId":"Bxxx","estimateMinutes":240,"blocked":false,"isMilestone":false,"completedAt":null}],
 "reqs":[{"id":"Rxxx","name":"...","desc":"","status":"active","createdAt":"2026-10-01"}],
 "comments":[{"taskId":"Kxxx","authorId":"Uxxx","authorName":"我","content":"...","createdAt":"2026-10-02T10:00:00"}],
 "deps":[{"from":"K1","to":"K2","type":"FS","lag":0}],
 "baseline":[{"taskId":"K1","start":"2026-10-01","due":"2026-10-08"}],
 "baselineAt":"2026-10-28T18:00:00",
 "reqDocs":[{"id":"Dxxx","reqId":"Rxxx","title":"...","content":"<p>...</p>","status":"draft","owner":"我"}],
 "branches":[{"id":"Bxxx","reqId":null,"name":"feature/login","status":"dev","owner":"我","targetBranch":"main"}]}
```

返回 `{"tasks": 42, "reqs": 5, "comments": 18, "reqDocs": 3, "branches": 2, "versions": 2, "demands": 4, "testCases": 12, "docComments": 6}`。

**覆盖语义（重要）**：导入清空并重建"任务类数据"——任务、回收站（保留原删除时间）、项目、子任务、标签、工时、**任务评论**、**甘特依赖与基线**与**完成归档**（完成归档按导入后的任务与工时重建，历史快照里的旧项目名/负责人名以备份数据为准）；v6 备份还会覆盖 **需求文档与分支**（含正文/状态/负责人，分支操作时间线清空）；**v10 备份还会覆盖测试用例、执行流水与文档评论**；旧备份没有对应字段时保留现状，不误删现有数据。**保留**附件文件与记录、操作时间线、保存视图、看板列、分类与优先级显示设置。跨空间复制导入时任务/项目/需求文档/分支 ID 冲突会自动重新生成并同步迁移引用（依赖端点按任务 ID 映射回指，自环/重复/成环边会被跳过）；看板列按备份补齐（跳过保留列 id=done 与超过 16 位的 id）、任务列按"列 id → 列名"两级映射落位。工时的计时人随备份恢复（`timeLogs[].userId`）；计时人不在目标空间（跨空间导入）时，该条工时归导入者。仅空间主可执行。导入会清除当前空间的只读分享令牌（旧链接立即失效），需要重新生成。

**旧备份兼容**：v3 及更早备份没有 comments 字段，v4 及更早没有依赖/基线字段，v5 及更早没有需求文档/分支字段，v10 之前没有测试用例/执行流水/文档评论；对应字段缺失时保留空间现有数据，不执行清空；新增任务字段缺失时按空值处理。

字段兜底：旧列 id（todo/review）自动映射、非法枚举取默认值、超长字段截断、无效项目/需求/分支引用置空；`subtasks`/`tags`/`recurType`/`remindAt`/`remindSent`/`timeLogs`（含计时人 userId）/`createdAt`/`columns` 导入时自动恢复，旧版备份（无这些字段）依旧兼容。

**导出不含**：附件文件本身（磁盘文件，随服务器备份目录 tar 保留，见 `deploy/backup.sh`）、操作时间线日志（导入时不会被删除）、完成归档快照（导入时按任务与工时重建）、分支操作时间线、需求文档历史快照（覆盖导入时会随旧文档清理，需从数据库备份恢复）。

## 16. 子任务（检查清单）

- `GET /api/tasks/{id}/subtasks` → `[{"id":1,"taskId":"Kxxx","title":"...","done":false,"createdAt":"...","updatedAt":"..."}]`
- `POST /api/tasks/{id}/subtasks`，body `{"title":"..."}`（必填，≤60 字）
- `PUT /api/subtasks/{id}`，body `{"title":"...","done":true}`（两个字段都可选，用于改名/勾选；父任务在回收站中时拒绝修改）
- `DELETE /api/subtasks/{id}`（父任务在回收站中时同样拒绝）

看板接口返回的任务对象带 `subtaskTotal` / `subtaskDone` 两个统计字段（卡片角标用）；子任务的增删改会自动写入任务操作时间线。

## 17. GET /api/calendar?year=2026&month=10

日历视图：返回该月内截止日期落在当月的任务（含已完成）。不传参数默认当月。

```json
{"code":0,"data":{"year":2026,"month":10,"tasks":[{...任务}]}}
```

## 18. GET /api/stats?weeks=8

统计报表：weeks 范围 4-26，默认 8。

```json
{"code":0,"data":{
  "weeks":[{"start":"2026-10-05","end":"2026-10-11","created":3,"completed":2}],
  "byCategory":[{"name":"后端","count":5}],
  "byOwner":[{"name":"我","count":8}],
  "current":{"backlog":5,"doing":3,"done":12,"other":2,"overdue":1,"workMinutes":320,"workMinutesWeek":95}
}}
```

口径：新增按创建日期、完成按完成日期；byCategory/byOwner 为窗口内完成任务的分布；current 为当前全量（`backlog`/`doing` 为内置列计数，自定义列中的任务计入 `other`；`workMinutes` 为累计计时工时、`workMinutesWeek` 为本周工时，单位分钟）。

## 19. POST /api/notify/test

立即对当前空间执行一次提醒推送（手动测试用，**仅空间主**）。需先在「空间设置」中配置该空间的推送 webhook。

```json
{"code":0,"data":{"sent":true,"content":"【开发工坊】任务提醒 2026-10-14\n逾期 2 项：..."}}
```

无逾期与今日到期任务时返回 `{"sent":false,"reason":"当前无逾期或今日到期任务，静默跳过"}`；手动测试（force）模式下即使为空也会发送一条测试消息。渠道由 `NOTIFY_TYPE` 决定：`webhook`（企微/钉钉，报文 `msgtype:text`）/ `serverchan`（Server酱，URL 里带 key，报文 `title/desp`）/ `pushplus`（报文 `token/title/content`，token 配 `NOTIFY_TOKEN`）。**pushplus 渠道下统一 token 只发送到官方固定端点（`https://www.pushplus.plus/send`），空间设置里的地址仅作为"启用推送"开关**；其余渠道的空间地址保存与发送时都会校验（仅 http/https，拒绝本机/内网地址），服务端不跟随重定向。推送结果以渠道**明确返回的成功码**为准（`errcode=0` / `code=0` / pushplus `code=200`）；HTML 错误页、空响应、跳转等无法确认成功的响应按失败处理，任务级提醒会保留在原 6 小时窗口内重试。超过 6 小时重试窗口仍未发出的提醒会被标记为已处理并在任务时间线记「提醒时间已过（超过 6 小时重试窗口），未推送」；未配置 webhook 的空间同样参与过期处理（记「提醒时间已过，空间未配置推送渠道，未推送」），不会永久静默挂起。

## 20. 回收站

- `GET /api/trash` → 已删除任务列表（按删除时间倒序，含 `deletedAt`）
- `POST /api/tasks/{id}/restore` → 从回收站恢复
- `DELETE /api/tasks/{id}/purge` → 彻底删除（含子任务、标签关联、附件文件、工时、操作日志）
- 说明：`DELETE /api/tasks/{id}` 现在是软删除（进回收站）；满 30 天由服务端每日 04:30 自动清理

## 21. 列表视图

`GET /api/tasks/list`，参数同看板（含 tags/focus），另加 `sort`：`column`（默认）/ `due` / `priority` / `updated`，以及 `offset` / `limit` 分页（单页上限 500）。返回：

```json
{"code":0,"data":{"items":[{...任务}],"total":128,"offset":0,"limit":500,"hasMore":false}}
```

`hasMore=true` 时前端用 `offset=已加载条数` 继续加载；`total` 始终是筛选后的真实匹配数。

## 22. 看板列配置

- `GET /api/columns` → 列定义（含系统列 `done`，`done:true`）
- `POST /api/columns`，body `{"name":"待验收","color":"#7a5c86"}` → 新增
- `PUT /api/columns/{id}`，body `{"name":"...","color":"#RRGGBB"}` → 改名/改色（「已完成」为保留名）
- `DELETE /api/columns/{id}` → 删除列，任务移入最靠前的列；backlog/doing 内置列不可删
- `PUT /api/columns/order`，body `{"ids":["doing","backlog",...]}` → 重排（须与现有列完全一致）

## 23. 标签

`GET /api/tags` → 有任务关联的标签 `[{"name":"线上问题","count":3}]`（写标签在任务保存接口的 `tags` 字段里，自动创建）。

## 24. 保存的筛选视图

- `GET /api/views` → `[{"id":"Vxxx","name":"我的 P0","params":"{\"pris\":[\"P0\"],...}"}]`
- `POST /api/views`，body `{"name":"我的 P0","params":"<筛选参数JSON字符串>"}`
- `DELETE /api/views/{id}`

params 为前端筛选状态序列化：`{q, owners, pris, cats, reqs, tags, due, focus, doneScope}`。服务端保存时校验结构（必须是 JSON 对象，数组字段须为字符串数组，focus 须为布尔）并只保留已知字段，非法参数返回 400；前端应用视图时同样先整体校验再一次性应用，参数不合法时保持当前筛选不变。

## 25. 任务附件

- `POST /api/tasks/{id}/attachments`（multipart，字段 `file`）→ 上传，≤10MB，允许 jpg/jpeg/png/gif/webp/pdf/txt/md/zip
- `GET /api/tasks/{id}/attachments` → 附件列表
- `GET /api/attachments/{id}/download` → 下载（inline；Content-Type 由服务端按扩展名判定，不信任上传方声明；图片可直接在页面预览）
- `GET /api/attachments/{id}/thumb` → 缩略图（≤200px，jpg/png/gif 服务端缩放；webp 等回退原图），列表预览用
- `DELETE /api/attachments/{id}` → 删除（含磁盘文件）
- 附件文件不随 JSON 导出/导入，随服务器备份目录保留（`deploy/backup.sh` 已含打包步骤）

## 26. 工时计时

- `GET /api/tasks/{id}/timer` → `{"running":false,"startedAt":null,"elapsedMinutes":0,"totalMinutes":45,"myTotalMinutes":30}`（`running/elapsedMinutes` 为"当前登录人"在该任务的计时状态；`totalMinutes` 为该任务全部成员的累计）
- `POST /api/tasks/{id}/timer/start` / `POST /api/tasks/{id}/timer/stop`（开始/停止仅作用于"我自己"；任务整体结算见下）
- `GET /api/tasks/{id}/timer/records` → 该任务的工时记录（已结束的计时 + 手工补记，按时间倒序最多 50 条）：`[{id,userId,userName,origin,minutes,date,startedAt,endedAt,note,mine}]`，`origin` 为 `timer`/`manual`；`startedAt/endedAt` 为原始起止时间（跨天计时据此判断，`minutes` 已按工作时段与每日上限裁剪）
- `POST /api/tasks/{id}/timer/manual?forUserId=&date=yyyy-MM-dd&minutes=&note=` → 手工补记一条实际工时（忘开表、加班等）。项目可写者可补**任何人**（`forUserId` 空则补自己，非空须为空间成员）；补记不经过工作时段/8 小时上限的计时裁剪，只做范围校验（1 分钟 ~ 24 小时、日期不晚于今天），`started_at=ended_at=所选日期 12:00`，落库 `origin=manual`；日期落在当天仍占用该用户的计时日额度
- `DELETE /api/tasks/{id}/timer/records/{logId}` → **作废**一条已结束的工时记录（计时记录与手工补记都可作废；运行中的计时须先停止）。权限与补记一致：项目可写者。记录物理删除，任务时间线留下"作废计时记录 / 删除补记工时"的审计文字
- 作废后所有统计直接读 `time_log` 自动按实际工时重算；任务若已有完成快照，服务端同步重算 `total_minutes / first_started_at / last_ended_at`（历史快照用 `sql/46_refresh_completion_minutes.sql` 一次性对齐）
- 计时按**人**归属（`time_log.user_id` = 计时人）：开始新计时只自动停止"我自己"其他任务上已可见的运行中计时，不影响他人；单次计时按「每个工作日的工作时段 + 每人每天上限（默认 8 小时）」折算，忘停表时不会把夜间与周末计入，也不会超过当天剩余额度；任务完成（移入已完成）或删除时自动停止并结算**该任务上全部成员**的计时；统计报表的工时只统计"我"在当前空间的记录
- 备份往返：`BackupTimeLog` 含 `origin`/`note`；旧备份缺 `origin` 的按 `timer` 回填

## 27. 实时变更事件（SSE）

`GET /api/events`（EventSource）：任一写操作成功后服务端广播 `changed` 事件，另有 `ping` 心跳（25 秒）。**事件在服务端按空间成员过滤**：携带空间 ID 的事件只投递给该空间成员的连接（非成员收不到任何事件）；账号管理等与空间无关的变更投递给全部订阅者（事件数据为空串）。前端另有当前空间过滤与轮询兜底。

## 28. CSV 导出

`GET /api/export/csv` → `text/csv`（带 BOM，Excel 直接打开），文件名 `workbench-tasks-YYYY-MM-DD.csv`。以 `=`/`+`/`-`/`@`/制表符/回车开头的文本单元格会自动加单引号前缀（防 Excel 公式注入，显示为原文）。

## 29. 邀请链接（共享空间协作）

账号仍由管理员创建下发（**不提供自助注册**）；邀请链接用于把**已有账号**的同事拉进共享空间：对方打开 `/join.html?code=XXXXXXXXXX` 后，已登录则一键加入；未登录先登录（登录后自动回到该页完成加入）。个人空间不可邀请。

- 生成：`POST /api/workspaces/{id}/invites`（仅空间主）→ `{id, expiresAt}`；邀请码为 10 位大写字母数字（去掉易混淆字符），有效期 **7 天**
- 列表：`GET /api/workspaces/{id}/invites`（仅空间主）→ `[{id, workspaceId, createdBy, expiresAt, usedCount, createdAt}]`
- 撤销：`DELETE /api/workspaces/{id}/invites/{inviteId}`（仅空间主）；删除空间时邀请一并清理
- 查看（公开）：`GET /api/invite/{code}` → `{workspaceName, inviterName, expiresAt}`；无效/已撤销 404，过期 400
- 加入（需登录）：`POST /api/invite/{code}/join` → `{workspaceId, workspaceName, already}`；`already=true` 表示原本就是成员（幂等，不再计数）
- `usedCount` 在每次成功加入时 +1；邀请码大小写不敏感（统一转大写查询）
- 安全：仅 `GET /api/invite/{code}` 为公开接口（放行见 SecurityConfig），`/join` 需登录；建议在 nginx 对邀请路径同样启用限速（与登录接口共用注释块）

## 30. GET /api/flow-health?days=90

流程体检：从 `task_log` 的跨列移动记录反推流程健康度。`days` 取 1-730，默认 90。只读，不改任何业务数据。

```json
{"code":0,"data":{
  "rangeDays":90,"since":"2026-07-24","generatedAt":"2026-10-22 16:58",
  "coverage":{"moveEvents":46,"usableMoves":44,"tasksTotal":13,"tasksWithMoves":9,
              "completedInRange":5,"note":"口径说明 / 数据不足时的引导语"},
  "columns":[{"id":"backlog","name":"待处理","color":"#8a8578","segments":18,
              "totalSeconds":486000,"avgSeconds":27000,"medianSeconds":21600,"p90Seconds":61200,
              "share":0.52,"ongoingCount":8,"ongoingMaxSeconds":1036800,
              "ongoingAvgSeconds":432000,"bottleneck":true}],
  "bottleneckId":"backlog","bottleneckName":"待处理","bottleneckShare":0.52,
  "rework":{"totalMoves":44,"backMoves":9,"backRate":0.2045,
            "completedTasks":5,"firstPassTasks":3,"firstPassRate":0.6},
  "priority":[{"priority":"P0","tasks":6,"avgMoves":3.2}],
  "reqDocs":{"total":5,"withTasks":3,"noTask":2,"avgLeadHours":30.4,
             "noTaskList":[{"id":"D9","title":"结算改造-对账口径调整","ageDays":12}]},
  "insights":[{"level":"warn","title":"最堵的是「待处理」","text":"..."}]
}}
```

**口径**（改这里之前先看 `FlowHealthService` 的类注释）：

- **列停留**：任务进入某列到离开该列的时间。`avgSeconds`/`medianSeconds`/`p90Seconds` **只统计已经离开该列的段**（`segments`），当前仍停在该列的单独给 `ongoingCount`/`ongoingMaxSeconds`，不混进历史均值。
- **`share` 的分母只含已结束的停留**，但包含「已被删除的列」那段时间；「已完成」列是终点，不计入停留（`segments` 恒为 0）。
- **回退** = 目标列在 `board_column.sort_order` 里比来源列更靠前。`totalMoves` 只含跨列移动（列内排序不算）。
- **一次通过率** = 时间窗内完成的任务里，窗内没发生过回退的比例（窗口口径，不是任务全生命周期）。
- **需求开工延迟** = `requirement_doc.created_at` → 首个关联任务 `created_at` 的平均小时数。
- **时长单位全部是秒**，由前端格式化。

**数据来源与兼容**：`task_log.from_column`/`to_column` 是 `09_task_flow.sql` 新增的结构化字段，`POST /api/tasks/{id}/move` 写入；历史数据在该脚本里按 `detail` 文本「从「X」移动到「Y」」回填，列改名过的会回填不上（`from/to` 留 NULL，计入 `coverage.moveEvents` 但不算 `usableMoves`）。Service 侧另有基于 `detail` 的兜底解析。

## 31. AI 辅助需求（按账号走自己的额度）

三件事：**配自己的 AI**、**把需求拆成任务草稿**、**检查需求做完了没**。
账号级配置（不是空间级）—— 额度是按人买的，换空间不用重填；共享空间里各人走各人的 key。

### 31.1 配置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ai/config` | 我的配置（**key 只回掩码**） |
| PUT | `/api/ai/config` | 保存（`apiKey` 空=不改，`clearKey=true`=删除） |
| POST | `/api/ai/config/test` | 用已保存配置发一次极小请求，验证 key/地址/模型 |

```json
{"code":0,"data":{
  "provider":"deepseek","baseUrl":"https://api.deepseek.com/v1","model":"deepseek-chat",
  "hasKey":true,"apiKeyMasked":"sk-****a1b2","enabled":true,"keyBroken":false,
  "status":"已就绪：调用会走你自己的额度",
  "presets":[{"id":"deepseek","name":"DeepSeek","baseUrl":"...","model":"deepseek-chat","keyHint":"..."}]
}}
```

**安全口径**（不要改）：

- Key 用 AES-GCM 加密后入库（`v1:` 前缀 + Base64(IV‖密文)），密钥来自 `app.ai.crypto-key`（部署用环境变量 `AI_CRYPTO_KEY` 覆盖）。
- 接口**永不回传明文**，只有 `apiKeyMasked`（`sk-****a1b2`，短 key 全遮）。
- 换过部署密钥 → `keyBroken=true`、`hasKey=false`，提示用户重填。**这是设计行为，不是故障**。
- 所有 AI 调用只从 `CurrentUser.id()` 取配置，**没有公共 key 兜底**：没配就直接报错。

**内置厂商**（全部 OpenAI 兼容，`baseUrl` 可改，可走中转/代理）：
DeepSeek、通义千问、月之暗面 Kimi、智谱 GLM、腾讯混元、OpenAI、本地 Ollama、自定义。
加新厂商只需改 `AiProviders`。

### 31.2 拆分与体检

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/ai/reqdoc/{id}/split?maxTasks=8` | 拆成任务**草稿**（不落库） |
| POST | `/api/ai/reqdoc/{id}/audit` | 完成度体检 |
| POST | `/api/ai/reqdoc/{id}/tasks` | 把勾选的草稿创建成任务 |

`split` 返回 `{reqDocId, reqDocTitle, docChars, tasks:[{title,description,priority,dependsOnIndex,reason}], usage}`。
喂给模型的是**已保存的正文**（转纯文本，保留段落/列表/表格行），超过 12000 字会截断并在 prompt 里注明；
同项目已有任务标题作为 few-shot 参考命名风格。

`audit` 返回 `{coverage, verdict, summary, nextStep, totalPoints, donePoints, doingPoints, todoPoints, missingPoints, points:[{point,covered,status,taskTitle,note}], tasks, usage}`。

**分工是刻意的**：AI 只负责"把需求拆成可验证的功能点"和"给每个点找覆盖它的任务"；
`coverage` 与 `verdict` **由服务端按规则算**，不让模型打分：

```
coverage = round((done×1 + doing×0.6 + todo×0.3 + missing×0) / total × 100)
verdict  = coverage>=95 且 missing==0 → done
         | coverage>=70 → mostly
         | coverage>=30 → partial
         | 否则 → not_started
```

理由：模型直接给的分"看起来合理但没法解释"，也无法保证"有缺失就不会说做完了"。

`tasks` 逐条创建，单条失败不影响其它条，返回 `{created, skipped, failed:[{title,reason}]}`；
与已有任务**同名会跳过**（避免重复建）。

**注意**：这两个接口是长请求（模型生成通常 20-60 秒），nginx 的 `proxy_read_timeout` 必须大于 120 秒，否则前端拿到 504。

### 31.3 周报润色

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/ai/review/polish?workspace=` | 把某一周的回顾数据写成一份可直接发出去的周报（只读，不落库） |

请求体：`{weekOffset: 0, note: "周三线上排查了支付超时"}`

- `weekOffset`：`0` 本周、`-1` 上周……不传按 `0`；服务端夹到 `[-52, 0]`。
- `note`（选填，≤200 字）：任务里体现不出来的事（线上排查、口头对齐、临时支持）。留空也行。

返回：

```json
{"code":0,"data":{
  "weekOffset":0,"label":"本周","weekStart":"2026-10-19","weekEnd":"2026-10-25",
  "report":"## 本周完成\n- 重构权限校验中间件，四个入口统一走鉴权\n…",
  "source":{"completed":3,"progress":2,"pendingDone":0,"truncated":false,"chars":1240,"withNote":true},
  "usage":{"model":"deepseek-chat","promptTokens":1580,"completionTokens":320,"totalTokens":1900,"jsonMode":false}
}}
```

**口径（与 31.2 同一条原则）**：数字不交给模型。完成数、按期率、延期、工时、逾期、P0 未关闭全部由
`ReviewService` 先算好、拼成"事实清单"塞进提示词，并明确要求模型只能引用、不得加总；
`source` 里的计数也是服务端给的，用来在界面上说明"这份周报基于多少条事实"。

- `report` 是**纯 Markdown 文本**（不带 ``` 围栏，服务端会剥掉围栏与"好的，以下是…"这类开场）：
  终点是粘进 IM/邮件，给 HTML 只会满屏标签。固定四节：本周完成 / 进行中 / 风险与阻塞 / 下周计划。
- 这一周**没有任何记录**时直接 400（"这一周没有任何工作记录，没有素材可写"），不调模型 —— 省额度也更诚实。
- 任务太多时只喂前 30 条完成 + 15 条进行中，并在 `source.truncated=true` 里说明。
- 同样是长请求（10-30 秒），前端按钮置灰 + 骨架屏；`ChangeBroadcastFilter` 不会广播（没有写操作）。

## 32. GET /api/estimate/stats

估时准确度与超支预警。只读。

```json
{"code":0,"data":{
  "tasksTotal":13,"tasksWithEstimate":7,"sampleCount":4,
  "overallFactor":1.42,"medianFactor":1.45,
  "underCount":0,"accurateCount":1,"overCount":3,
  "byCategory":[{"category":"后端","sampleCount":2,"estimateTotal":600,"actualTotal":1000,"factor":1.67}],
  "atRisk":[{"id":"K1","title":"重构权限校验中间件","category":"后端","column":"doing",
             "estimateMinutes":480,"actualMinutes":520,"ratio":1.08,"level":"danger"}],
  "overrun":[{"id":"D3","title":"次席出金接口幂等校验","estimateMinutes":240,
              "actualMinutes":420,"ratio":1.75,"level":"danger"}],
  "suggestion":"你的估时偏乐观：……下次填预估时，把心里的数乘 1.42 再填。",
  "note":"口径：实际 = 计时记录……"
}}
```

### ⚠️ 为什么不用 `start_date` 算工期

**开始日期是"什么时候接到的"，不是"什么时候动手"。** 一个任务可能今天创建、下周才真正开工，
`[开始, 完成]` 之间的跨度里大部分是排队等待 —— 拿它算效率只会得出"我干活很慢"的错误结论。

唯一的可比基准是两个数：

| | 来源 | 说明 |
| --- | --- | --- |
| **预估** | `task.estimate_minutes` | 人自己填的，单位分钟（表单用小时，0.5 步进） |
| **实际** | `time_log.minutes` 累计 | 已按工作时段折算、跳过周末、每天封顶 |

`start_date` / `due_date` 仍然只用于日历排布与逾期判断，**不参与任何效率计算**。

### 口径

- **系数 = Σ实际 / Σ预估**（不是"平均每个任务的比值"）。后者会让"预估 0.5h 实际 2h"（4 倍）的小任务
  和"预估 40h 实际 60h"（1.5 倍）的大任务等权重，结论会被小事带偏。
- **只统计已完成任务**：进行中的实际值还不完整，算进去会显得"总是高估"。
- **偏差分档**：实际/预估 `< 0.85` 高估 / `0.85~1.15` 准确 / `> 1.15` 低估。
- **预警只看进行中**（非 `backlog`、非 `done`）且 `实际/预估 ≥ 0.8`：`≥ 1.0` 记 `danger`（已超），否则 `warn`（接近）。
  `backlog` 里的任务还没开工（实际 0），预警没有意义。
- `estimate_minutes` 为 `null` 或 `0` 一律视为"没估"，不参与任何统计；保存时也统一存 `NULL`。

## 33. 测试用例（/api/test-cases）

层级：空间 → 项目（`/api/reqs`）→ 用例 → 执行流水。读接口仅需项目可见（viewer 可看），
写接口（创建/更新/删除/执行/转缺陷）需项目写权限（viewer 返回 403「你对该项目只有查看权限」）。
所有接口均可带可选参数 `workspace`（缺省用会话上次空间）。用例列表带最近一轮执行结果与转出缺陷标题。

| 接口 | 说明 |
| --- | --- |
| `GET /api/test-cases?reqId=` | 项目用例列表（`steps` 已解析为 `[{action,expected}]` 数组） |
| `GET /api/test-cases/stats?reqId=` | 执行概览 `{total, passed, failed, blocked, untested}`（未执行由总数反推） |
| `POST /api/test-cases` | 新建用例（`reqId/title/precondition/steps[]`，标题 ≤100，步骤 ≤30 条） |
| `PUT /api/test-cases/{id}` | 保存用例（可换项目，新旧项目均需写权限） |
| `DELETE /api/test-cases/{id}` | 删除用例（执行流水一并删除；转出的缺陷任务保留） |
| `POST /api/test-cases/{id}/runs` | 记录一次执行：`{status: passed|failed|blocked, note?}`，最近结果冗余回用例 |
| `POST /api/test-cases/{id}/defect` | 失败转缺陷：`{severity: blocker|critical|major|minor, environment?}`，生成 bug 任务并回填用例/流水引用；仅最近结果为 `failed` 时可用 |

转出缺陷的标题/描述按任务口径（60/200 字）截断，完整步骤与失败备注保留在用例本体；描述拼装为
「前置条件 + 执行步骤（含预期）+ 失败备注」。删除项目会级联清理用例与流水；删除/清空空间同样清理。
v10 备份覆盖导入会先清空再按备份恢复用例与流水；旧备份没有用例字段时保留现有用例，不误删。

## 已接受的现状口径（按设计如此，非缺陷）

以下行为是当前版本有意保留的设计边界，使用/验收时按此预期判断：

1. **会话与权限快照**：登录会话 30 天有效，角色写在会话里。管理员**重置密码/调整角色/删除账号不会踢掉旧会话**（无会话注册表）；但 `/api/admin/**` 每次请求按数据库当前角色复核，被降权或删除的管理员立即无法再调用管理接口；`/api/auth/me` 也读取数据库实时角色。普通接口的权限变化在下次登录（或会话过期）后完全生效。
2. **任务并发写为"最后写入生效"**：多人同时编辑同一任务不做版本校验/冲突提示，后提交的整体覆盖先提交的（实现范围约定，界面无冲突弹窗）。
3. **JSON 导入导出不做全量恢复**：导出对象不含附件二进制、需求文档正文、分支与操作时间线；导入覆盖任务类数据（任务/项目/评论等），保留附件文件/记录与时间线（保留的附件/日志按"空间+任务ID"关联，同空间原样导回会重新挂回原任务）。
4. **文件与数据库无两阶段一致性**：附件删除为"先删文件、后删记录"（或相反顺序的单边提交），极端故障下可能出现孤儿文件或失效引用；失败会写服务端告警日志，不做补偿任务。
5. **同账号跨设备计时并发窗口**：开始计时为无锁"先查后插"，同一账号在两台设备极端同时点击"开始"可能短暂并存两条运行记录；单设备串行操作与不同账号之间不受影响，任务完成/删除时会统一结算。已完成的任务仍可手动开始计时（用于事后补录），未做禁止。

## 任务对象新增字段说明

`recurType`（daily/weekly/monthly/null）、`recurNextId`（循环任务派生的下一次任务ID：把已完成任务移回未完成再重新完成时复用该任务，不会重复生成；**彻底删除派生的下一次任务会清除该关联**，此后再次完成会重新生成；回收站中的派生任务视为仍存在）、`remindAt`（yyyy-MM-ddTHH:mm）、`tags`（字符串数组）、`totalMinutes`（累计工时）、`subtaskTotal/subtaskDone`、`deletedAt`（回收站中非空）。任务保存接口 `POST/PUT /api/tasks` 同步接受 `recurType`（空字符串=清除循环）、`remindAt`（null=清除）、`tags`（最多 8 个、每个 ≤16 字）。

---

## 附录 · 2026-10-16 功能评估报告改造（v1.1 增量）

> 迁移脚本：`sql/03_report_2026-10-16.sql`（纯增量、幂等，用 information_schema + PREPARE 动态执行，无需存储过程权限）。
> 可选脚本：`sql/04_backfill_owner_user.sql`（把历史负责人文本回填成账号ID，不跑也能用，见下文 N-2）。

### 1. 任务对象新增字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `ownerUserId` | string / null | 负责人账号ID（N-2 身份绑定）。**为空时全部下游逻辑回落 `owner` 显示名文本**，因此不需要回填即可工作 |
| `remindTarget` | `owner` / `owner+admin` | 提醒谁（N-1），默认 `owner` |
| `blocked` | bool | 是否被阻塞（N-4 卡点） |
| `blockedReason` | string(120) / null | 卡点原因 |
| `blockedByTaskId` | string / null | 等待的任务ID（可选依赖，仅做记录不参与计算） |
| `commentCount` | int | 评论条数（非表字段，查询时合并填充） |
| `workspaceName` | string | 所属空间名（非表字段，仅 `/api/my-tasks` 返回） |

`POST/PUT /api/tasks` 同步接受 `ownerUserId` / `remindTarget` / `blocked` / `blockedReason` / `blockedByTaskId`。

### 2. 通用查询参数新增

| 参数 | 取值 | 适用 | 说明 |
|---|---|---|---|
| `blocked` | `true` | `/api/board`、`/api/tasks/done`、`/api/tasks/list` | 仅看被阻塞任务（N-4） |
| `noDue` | `true` | 同上 | 仅看没有截止日期的任务（O-25 日历「本月未排期」） |

`q` 的匹配范围已扩展（O-8）：标题 / 描述 / 进度备注 **+ 项目名 + 分类名 + 标签名 + 附件文件名**。回收站任务不纳入搜索。

### 3. 新增接口

| 接口 | 说明 |
|---|---|
| `GET /api/task/{id}` | **任务深链读取**（O-3）。刻意用单数路径，与 `/api/tasks/list`、`/api/tasks/done` 零歧义。只在「我参与的空间」内查找；不存在与无权限同样返回 404（不泄露存在性）；回收站中的任务照常返回（`deletedAt` 非空），由前端提示"已被删除，可在回收站查看" |
| `GET /api/tasks/{id}/comments` | 评论列表（N-6）。**回收站中的任务保留可读** |
| `POST /api/tasks/{id}/comments` | 发评论，body `{"content":"…"}`（≤500 字）。回收站中的任务拒绝（400）；会写一条时间线并定向通知负责人本人 |
| `DELETE /api/comments/{id}` | 删评论，**仅作者本人**（403） |
| `GET /api/my-tasks?scope=open\|all&offset=0&limit=200` | 跨空间「我的任务」（N-3，TOP-6 起分页）。返回 `{items,total,offset,limit,hasMore,truncated,spaces,matchedByNameOnly}`；`total` / `spaces` / `matchedByNameOnly` 均按筛选后的**全量**统计，`hasMore` 表示还能取下一页（`truncated` 为兼容别名） |
| `GET /api/activity?limit=200` | 空间级活动流（O-9）。复用 `task_log`，配置类事件以哨兵 `task_id='CFG'` + `action='config'` 落库（不会混进任何任务时间线） |
| `GET /api/notify/status` | 推送**真实生效状态**（O-1）：`{enabled,enabledSource,channel,channelSource,workspaceHasAddress,hasToken,workspaceHasToken,lastAttemptAt,lastResult,lastError,disabledReason}`。仅空间主；不回传地址与 token 原文 |
| `GET /api/notifications?workspace=&limit=` | 应用内通知列表 + 未读数（N-1） |
| `GET /api/notifications/unread` | 未读数（铃铛角标轮询） |
| `POST /api/notifications/{id}/read` | 标记单条已读（限本人） |
| `POST /api/notifications/read-all` | 全部已读（可按空间） |

### 4. 行为变化（破坏性为零，但语义要清楚）

1. **测试推送不再"假绿"（O-1③）**：`POST /api/notify/test` 走与定时任务相同的开关判断。总开关未开时返回 `{sent:false, enabled:false, reason:"服务端未启用推送（app.notify.enabled 未打开），定时提醒不会发送；本次为单次测试"}`。
2. **推送渠道下沉到空间级（O-1）**：`workspace` 新增 `notify_channel` / `notify_enabled` / `notify_token` / `notify_last_at` / `notify_last_status`。`notify_enabled = NULL` 表示"跟随全局 `app.notify.enabled`"，因此**升级后行为不变**。`PUT /api/workspaces/{id}` 接受 `name` / `notifyWebhook` / `notifyChannel` / `notifyEnabled` / `notifyToken` / `clearToken`，未提交字段保持原值（`notifyWebhook` 传空串才清除；`notifyToken` 留空保持原值，`clearToken=true` 才清空）。`pushplus` 渠道下空间地址仅作启用开关（仍只发官方端点）；`serverchan` 只填 Token 时服务端按 `https://sctapi.ftqq.com/{token}.send` 补全地址。
3. **任务级提醒定向到人（N-1）**：到点提醒除了按空间配置发外部渠道，**一定会写应用内通知**给负责人本人（`remind_target=owner+admin` 时加上空间主）。负责人未绑定账号时按显示名匹配空间成员。所以**不配群机器人也能收到提醒**。同一收件人+同一任务+同一类型 6 小时内去重。
4. **只配外部渠道时以它为准决定闭环**：配了渠道但发送失败 → 保留在 6 小时重试窗口内；完全没配外部渠道 → 应用内送达即闭环，并在时间线记录「提醒时间已到，空间未启用外部推送，已通过应用内通知送达」。
5. **SSE `changed` 事件载荷（O-11）**：升级为 JSON `{"w":"空间ID","t":"任务ID","a":"操作人显示名"}`（字段按需出现）。**旧格式（纯空间ID文本）继续兼容**，前端两种都解析。用途：前端判断"是不是当前打开着的这条任务被改了"，给出「此任务刚被 X 修改，点击刷新」的轻提示，**不自动覆盖未保存草稿**。
6. **撤销删除的时间线文案（O-26）**：`POST /api/tasks/{id}/restore` 在 120 秒内的这次恢复记为「撤销删除：…回到看板」，更早的记为「从回收站恢复…」。
7. **配置类破坏性操作留审计（O-9）**：删除看板列 / 分类 / 项目会写一条 `action=config` 的活动记录。
8. **`/api/stats` 新增全空间工时**（N-5）：`current.workMinutesAll` / `current.workMinutesWeekAll`。原 `workMinutes` / `workMinutesWeek` 仍是"仅我"。
9. **`/api/review` 新增三处**（N-5 / O-10）：`workMinutes{space,mine,spaceWeek}`、`pendingDone[]`（进度 100% 但未入已完成列）、`members[].minutes`。
10. **保存视图 params 新增 `blocked`**（可选布尔）：服务端校验时保留，历史视图不受影响。
11. **`GET /api/board` 的 `columnDefs` 已按空间自定义列返回**（本次一并核对）。

### 5. 未做 / 边界

- `sql/04_backfill_owner_user.sql` 是**可选**的：不跑，`/api/my-tasks` 与定向通知按显示名回落，同名成员无法区分；跑了才彻底消除串号风险。脚本只填空值、可回滚（`owner_user_id` 置回 NULL）。
- CSV 导出（`/api/export/csv`）仍只导任务一张表，未按项目/工时拆多张表（**v1.2 已在任务 CSV 里补齐阻塞/卡点/工时/提醒四列**，见文末 v1.2 附录）。
- ~~评论不做 @提及与提及通知（报告 §8.5/§10.1 Q5 的建议口径）~~ —— **已于 2026-11-06 实现，见文末「通知机制优化」附录**。
- `blockedByTaskId` 只是记录字段，不参与任何计算或校验。

## 附录 · 第二轮功能复评 + 第九轮代码审查改造（v1.2 增量）

来源：`工作台DevStudio-功能复评报告-2026-10-16.html`（R-1 ~ R-4、§5.3）与 `docs/archive/code-review-round9-2026-10-16.md`（1 个 P2 + 8 个 P3）。
**没有改动任何接口的路径与入参结构**，以下是语义 / 行为上的变化。

### 1. 接口契约变化

| 接口 | 变化 |
| --- | --- |
| `GET /api/notifications` | 前端**已接上**（铃铛即通知中心）。前端按**跨空间**口径调用（不带 `workspace`），拿到的是"我的全部未读"；接口自身的 `workspace` 过滤能力不变。 |
| `GET /api/notifications/unread` | 同上，跨空间调用；前端 3 秒节流 + 60 秒兜底轮询。 |
| `POST /api/notifications/{id}/read`、`/api/notifications/read-all` | 行为不变，但**不再触发 SSE 广播**（标记已读是收件人私事，不改变任何共享数据）。 |
| `GET /api/my-tasks` | 语义明确为**跨空间**；该方法不接受 `workspace` 参数（多余参数会被忽略，前端已改为显式跨空间调用）。 |
| `GET /api/export/csv` | 任务 CSV **新增 4 列**：`是否阻塞`、`卡点原因`、`累计工时(分钟)`、`提醒时间`。原有 14 列的列序与含义不变，新列追加在末尾。 |

### 2. 行为变化

1. **业务失败的写请求不再广播 SSE**（第九轮 #4）：`ApiResult.code != 0`（HTTP 仍是 200）时不再触发 `changed`，避免被业务规则拒绝的操作让全空间白刷一次。
2. **改名不再无差别改写"负责人文本"**（复评 R-2）：`owner_user_id = 该用户` 的任务无条件同步；`owner_user_id` 为空的历史任务，仅在"该空间内没有另一个同名在册成员"时才同步。同名串号的口子封住，且未回填数据也不会显示旧名。
3. **每日汇总也写应用内通知**（复评 R-3）：`dailyPush` 从"只遍历配了 webhook 的空间"改为遍历**全部启用**的空间；汇总按负责人分组落应用内通知（type=`task_due`）。因此**没配群机器人时汇总不再完全静默**。外部渠道行为不变（未配地址就不发外网）。
4. **提醒扫描按空间/按任务隔离异常**（复评 R-4）：任一空间或任一任务出错只跳过该条，不再中断整轮扫描（原实现一个 try 包住所有空间）。
5. **任务级联删除补齐评论与通知**（第九轮 #1/#2）：彻底删除任务（`DELETE /api/tasks/{id}/purge`、回收站每日自动清理）、清空空间、覆盖导入三处，都会一并删除 `task_comment` 与 `app_notification` 中该任务的记录。
   - 修正的后果：此前 `countChildRefs` 把评论计入，导致**已彻底删除的任务 ID 被永久锁死**（既不能新建同 ID，同 ID 还原还会把旧评论挂到新任务上）。
   - 导入口径：评论与通知**跟随任务删除**，与"操作时间线保留"有意区分 —— 时间线是审计记录，评论/通知会把内容直接展示给用户，留着就是可见的数据错乱。
6. **看板兜底列**（第九轮 #3）：空间的 `board_column` 为空（手工改库 / 异常恢复）时，未完成任务归入 `backlog`，而不是被静默丢弃（原实现响应里只剩「已完成」一列）。
7. **工时口径自洽**（第九轮 #5）：`/api/review` 的 `members[]` 在"成员贡献合计 < 空间总工时"时，追加一行 `name = "已离开成员 / 未在册"`，把差额显式列出。
8. **ID 生成**（第九轮 #6）：`Ids.gen` 的随机后缀由 `Math.random()` 4 位改为 `ThreadLocalRandom` 8 位（同毫秒组合数从 ~1.7×10⁶ 升到 ~2.8×10¹²），ID 仍 ≤32 字符。
9. **启动兜底的事务语义**（第九轮 #7）：`ensureDefaults` 改为通过自身代理调用 `ensureDefaultsFor`，实现**每个空间一个独立事务**（此前 `@Transactional` 因同类自调用而失效，等于每个 mapper 各自提交）。
10. **删除看板列的审计文案**（第九轮 #9）：活动流里写列名而不是列 ID（不再出现「其下任务已移入「C1a2b3c4」」）。
11. **删除零调用死代码**（第九轮 #8）：移除 `TimeLogMapper.sumSinceByWorkspaceUserFrom`（与 `sumSinceByWorkspaceUser` 完全重复且全项目零调用）。

### 3. 未做 / 边界

- 通知中心不做"按空间分组折叠"，不做已读回执；默认拉取上限 30 条（接口支持 `limit`，上限 200）。
- ~~评论仍不做 @提及~~（**2026-11-06 已实现**，见文末附录）；通知不接浏览器系统级推送（仍是站内通知 + 外部渠道）。
- CSV 仍未按项目/工时**拆成多张表**（任务 CSV 已含这两类信息）。
- 用户被删除后，其作为收件人的历史 `app_notification` 不清理（本轮报告未提，属低频残留）。
- 复评列出的 4 个借鉴项里，仅 **#2 快速录入语法扩展**落地（`@负责人` / `+标签` / `%进度` / `~循环`）；**#1 命令面板、#4 任务模板、#7 日历 ICS 导出与拖动改期**未做。

## 附录 · 2026-10-19 四项体验修复（v1.3 增量）

来源：用户实测反馈 4 条。**1 个 SQL 修复 + 1 个字段新增 + 2 个口径 / 交互修正**，没有改动任何既有接口的路径与出参结构。

### 1. 接口契约变化

| 接口 / 字段 | 变化 |
| --- | --- |
| `GET /api/my-tasks` | 返回的每个任务现在带 `workspaceName`。此前该字段恒为 `null` —— 因为 `selectMyTasks` 只 `SELECT` 了 `task` 表、没有 JOIN `workspace`，前端「空间」列只能显示「—」。修复：补 `LEFT JOIN workspace w ON w.id = t.workspace_id` + `w.name AS workspace_name`（其余列加 `t.` 前缀避免歧义）。 |
| `task.startDate`（**新增字段**） | `DATE`，可空。语义：任务开始日期。`POST/PUT /api/tasks` 接受 `startDate`（yyyy-MM-dd）；`startDate > dueDate` 返回 400「开始日期不能晚于截止日期」。备份导出 / 导入的 `tasks[].start` 同步带上（老备份没有该字段 → 空值，向后兼容）。 |
| `GET /api/calendar` | 口径从「**截止日期落在本月**」改为「**与本月有交集**」：按 `[start_date, due_date]` 区间判断；`start_date` 为空（或晚于截止日期）时退化为只占截止日那一格，与升级前行为完全一致。**响应结构不变**。 |

### 2. 数据库

- 新增 `sql/05_task_start_date.sql`（幂等，只 `ADD COLUMN`）：`task.start_date DATE NULL`。
- 老数据该列为 `NULL` → 日历行为与升级前一致，**不需要回填**。

### 3. 前端行为变化

1. **切换空间一律二次确认**（三处统一走 `askSwitchWorkspace`）：
   - 侧边栏空间菜单的手动切换；
   - 「我的任务」点其它空间的任务（原先是 toast 之后直接 reload —— 最容易误触）；
   - 通知中心点其它空间的通知。
   确认框写明目标空间名（跨空间任务还会带上任务标题），并提示「当前空间的筛选条件、抽屉里未保存的编辑都不会保留」；**取消则不发任何请求**（连 `select` 都不发）。
2. **「一周后」= 5 个工作日**（跳过周六日），不再是 +7 自然日。三处共用同一个 `duePresetDate`：抽屉内的日期预设按钮、卡片 `D` 键改期浮层、列表批量改截止。今天 / 明天仍按自然日。
3. **日历按区间逐日展示**：填了开始日期的任务会在 `[开始, 截止]` 的每一天出现，非截止日弱化显示（`.cal-chip.span`）；右侧当日列表也按区间包含判断。没填开始日期的任务行为不变。

### 4. 未做 / 边界

- 开始日期**不会**自动填充（不根据「移入进行中」隐式设置），保持显式录入。
- 循环任务派生下一次时 `startDate` 置空（新周期尚未开始）。
- 日历仍不显示"没有截止日期"的任务（它们进「本月未排期」区）。

### 5. 补充：周回顾「推进中」口径修正（同日第二轮反馈）

`GET /api/review` 的 `progressTasks` 原来只判断 `progressOf(t) > 0`，而 `TaskCalc.progressOf` 对**已完成列的任务一律返回 100** —— 于是已完成的任务会同时出现在「本周完成」和「推进中」两个区块里，读起来就是同一件事写了两遍。

现在三个区块严格互斥：

| 字段 | 口径 |
| --- | --- |
| `completed` | 已完成列，且 `completed_at` 落在本周期 |
| `pendingDone` | **未完成**列但进度 = 100%（单独成组，提醒去归档） |
| `progressTasks` | **未完成**列且 0 < 进度 < 100 |

响应结构不变，只是 `progressTasks` 的条数会变少（不再含已完成与进度 100% 的）。

> 已知局限（**部分已修，见 v1.5**）：`progressTasks` 取的是**当前**进度，不按周做历史快照。看历史周期时已按"那一周有活动"收敛（v1.5），但"进度数字"仍然是现在的值，不是上周结束时的值 —— 要精确到周需要每次改动都记录进度历史，属另一个量级的改造。

## 附录 · 2026-10-20 计时与周回顾（v1.4 增量）

### 1. 计时：拖列自动开关 + 有效工时口径

| 变化 | 说明 |
| --- | --- |
| **移入「进行中」自动开始计时** | `POST /api/tasks/{id}/move` 目标列不是 `backlog` 也不是 `done` 时，为**操作人**自动开始计时；若本人已有别的任务在计时，按原有"个人同一时刻只计一个任务"的规则先停掉它。响应新增 `autoTimerStarted: boolean`，前端据此提示「已开始计时」。 |
| **移入「已完成」自动结束** | 原有行为保留：关闭**该任务上所有人**的运行中计时。删除 / 移入回收站同样关闭。 |
| `TaskMoveRequest.autoTimer`（**新增**） | 可选布尔。不传 = 自动计时（拖拽、键盘移列、列表/日历的"移动到"）；传 `false` = 不自动（**取消完成**回退到进行中时用，避免"纠正状态"顺手开表）。 |
| **有效工时口径**（全新） | 停表时不再用"实际经过时间、上限 12 小时"，改为按 `WorkTime.effectiveMinutes()` 计算：① **跳过周六 / 周日**（整段落在周末记 0）；② **每人每天最多计入 8 小时**，并扣减当天已记录的工时（跨任务、跨空间都算）。运行中的 `elapsedMinutes` 也用同一口径。 |
| 时间线文案 | 停表日志改为「本次计入 N 分钟」，被裁剪时补一句「已按每天 8 小时 / 跳过周末裁剪，实际经过 M 分钟」。 |

**口径说明（容易踩的点）**：跨天计时按天切分、每天各自封顶 8 小时。例如周五 18:00 开表、周一 09:00 停表 → 周五记 6 小时 + 周末 0 + 周一封顶 8 小时 = 14 小时。这是"每天 8 小时"的字面实现；如果希望"跨天只算开始当天"，属于另一种口径，需要再确认。

> **v3.1 修订（2026-10-23）：按「工作时段」而不是自然日切段。**
> 原实现从每天 00:00 切，所以忘停表过夜时，凌晨一过就开始重新累计（用户实测报障）。
> 现在只计**工作时段**内的时长：默认 **09:00–18:00**，每个账号可在「个人设置 → 计时设置」自己调
> （`app_user.work_start_hour` / `work_end_hour`，开始 0-23、结束 1-24，结束须晚于开始）。
> 于是：周一 18:00 开表 → 周二 10:00 停表，只记周二 09:00–10:00 = **60 分钟**；
> 周一 22:00 → 周二 08:00 则记 **0**。周末跳过与"每天封顶"两条规则不变。
>
> **v3.2（同日）：每天上限也可配。** `app_user.work_max_hours`（1-24，默认 8）。
> 上限仍是"人的属性"：跨任务、跨空间一起扣减；时段比上限短时以时段长度为准。

### 2. 周回顾：`progressTasks` 改为按所在列

`GET /api/review` 的 `progressTasks`（前端「进行中」面板）口径改为：

> **未完成列且不在 `backlog` 列**，且进度未到 100%（100% 的归 `pendingDone`）。

原来按「0 < 进度 < 100」过滤，但很多人不会手动拖进度条 —— 进行中的任务进度就是 0，整块永远是空的，看起来像"没有进行中的任务"。现在只要任务被移进「进行中」（或任何自定义中间列）就会出现。排序改为**先按截止日期、再按进度倒序**。

响应结构不变（`progressTasks[]`）。

### 3. 周回顾页面渲染修复

`completedAt` 为 `null` 的历史任务会让 `fmtShortMD(parseDate(null))` 抛 `getMonth of null`，**整个周回顾渲染中断** —— 表现为「复制总结」里有完成明细、页面上却看不到。已修：
- `fmtMD / fmtShortMD / fmtFull / weekdayCN` 全部容忍 `null`（返回 `—` / 空串）；
- 完成列表里缺完成时间的条目显示「完成时间未记录」，不再中断渲染。

### 4. 文案调整

- 面板标题：「进展更新」→ **「进行中」**（并显示 `共 N 项`）；「完成明细」→ **「本周完成」**。
- 复制总结文本：先「进行中（N 项）」再「本周完成（N 项）」，不再出现「完成明细」字样；缺完成时间的条目写「（完成时间未记录）」。

### 5. 补丁（v1.5）：历史周期的「进行中」按周收敛

**问题**（用户实测反馈）：切到「上一周」时，「进行中」面板仍然列出**当前**进行中的任务 —— 包括这一周才创建 / 才拖进进行中的任务，等于把本周的工作算进了上周。

**原因**：`progressTasks` 是"当前状态"，与周期无关。

**修法**：`GET /api/review` 在 `weekOffset < 0`（历史周期）时，对 `progressTasks` 再做一次收敛：

> 只保留「**该周期内有日志活动**」（`task_log.created_at` 落在周期内）**且**「周期结束时任务已存在」（`created_at <= 周期结束日`）的任务。

- **本周（`weekOffset == 0`）不收敛** —— 「进行中」就该是"我现在在做的事"，不受"本周有没有动过"限制；
- 没有状态快照，用日志近似还原。因此「上周开工、这周一直没碰」的任务在本周视图里仍然出现（符合直觉），在更早的周期里则按"那一周动过"判断；
- 新增 `TaskLogMapper.selectActiveTaskIds(workspaceId, from, to)`（`DISTINCT task_id`，排除 `CFG` 哨兵事件）；
- `ReviewResponse` 结构不变。

**仍存在的局限**：进度数字仍是当前值；"上周拖进进行中、本周已完成"的任务只会出现在「本周完成」里，不会同时出现在上周的「进行中」。

### 6. 补丁（v1.6）：日历里提前完成的任务不再往后铺

**问题**（用户实测）：任务 5 号开始、25 号截止，12 号就做完了，但日历从 13 号到 25 号仍然每天显示它。

**原因**：日历区间是 `[start_date, due_date]`，没有考虑 `completed_at`。

**修法**：引入"**实际结束日**"概念：

> `实际结束日 = (已完成 && completed_at < due_date) ? completed_at : due_date`

| 位置 | 处理 |
| --- | --- |
| `GET /api/calendar` | 用实际结束日判断"与本月是否有交集"，提前完成的任务不再因为 `due_date` 在未来而被返回 |
| 前端 `calRangeOf(t)` | 日历格子铺开、右侧当日列表的区间判断都用同一个函数；已完成任务的 chip 带 `done` 样式（划线），悬停提示显示「已完成 10-12」而不是「进行中，截止 10-25」 |
| 边界 | `completed_at` 为空（历史数据）→ 退回 `due_date`，行为与升级前一致；"取消完成"会把 `completed_at` 置空，区间自动恢复满铺 |

`CalendarResponse` 结构不变。

## 附录 · 2026-10-21 看板计时与任务清单（v1.7 增量）

### 1. 新接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/my-running-timer` | **全局接口**（不走 `?workspace=`）：返回我当前正在计时的任务。个人同一时刻只计一个，所以最多一条。出参 `{running, taskId, workspaceId, workspaceName, taskTitle, startedAt, elapsedMinutes}`；没有运行中时只有 `running:false`。前端必须用 `API.getGlobal` 调，看板卡片靠它渲染「计时中」。 |
| `GET /api/completions?month=YYYY-MM` | 任务清单（完成快照），按月返回，按 `completed_at` 倒序。`month` 为空取当月；格式不对返回 400「月份格式应为 YYYY-MM」。走当前空间（`?workspace=`）。 |

### 2. 新表 `task_completion_record`

任务完成那一刻落一条**快照**，之后任务改名 / 换项目 / 被删除都不影响已归档的统计 —— 这是"统计"与"查当前任务表"的本质区别。

| 字段 | 说明 |
| --- | --- |
| `workspace_id` + `task_id` | 唯一键 `uk_ws_task`，同一任务重复完成只保留最后一次 |
| `title` / `description` | 完成时的名称与详情（截断 200 字） |
| `req_id` / `req_name` | 归属项目；**项目名冗余存一份**，防项目改名或删除后统计失真 |
| `owner` / `owner_user_id` | 负责人（快照） |
| `category` / `priority` | 分类与优先级（快照） |
| `start_date` | 任务开始日期 |
| `completed_at` | 完成日期（必填） |
| `first_started_at` / `last_ended_at` | 首次计时开始 / 最后一次计时结束（来自 `time_log` 的 MIN/MAX） |
| `total_minutes` | 总耗时（`time_log.minutes` 汇总，已按「每天 8h / 跳过周末」裁剪） |

迁移脚本：`sql/06_task_completion_record.sql`（幂等建表 + 自检 + 可选的存量回填语句，默认注释）。

### 3. 归档时机

| 时机 | 动作 |
| --- | --- |
| `move` 到已完成列 / `PUT /api/tasks` 把列改成已完成 | `upsert` 一条快照 |
| 取消完成（离开已完成列） | 删除该 task_id 的记录，再次完成会重新生成 |
| 软删除（进回收站） | **保留**归档（"做过"是事实） |
| 彻底删除（回收站清理 / purge） | 一并删除，避免任务 ID 复用时把新任务的归档写到旧记录上 |

### 4. 前端行为

1. **卡片上直接计时**：每张卡片右上角多一个计时按钮（时钟图标，hover 出现）。未运行 → 点击开始；自己正在计时 → 按钮常驻高亮（绿色 + 图标脉动）、卡片 meta 首位显示实时工时。
2. **互斥**：开始 B 会自动停掉 A（后端 `start()` 的既有规则），前端在 toast 里明确写出「已开始「B」的计时 · 自动暂停了「A」」。
3. **已完成列显示总耗时**：卡片 meta 显示 `总耗时 6h41m`。
4. **任务清单视图**（侧边栏「任务清单」）：按月表格 + 4 个统计卡（完成数 / 总耗时 / 平均每项 / 参与成员）+ 上月/下月切换 + **导出 CSV**（带 BOM，Excel 打开不乱码）。

### 5. 补丁（v1.8）：只有「进行中」能计时 + 任务清单精简列

**问题**（用户实测）：
1. 计时中的绿色按钮常驻卡片右上角，**盖住了标题**；
2. 「待处理」「已完成」列也能点计时，不符合业务（只有开工的任务才该计工时）；
3. 任务清单里的「首次计时 / 最后计时」两列对统计没用。

**修法**：

| 项 | 变化 |
| --- | --- |
| 手动开始计时的入口 | `POST /api/tasks/{id}/timer/start` 现在校验任务所在列：`backlog` / `done` 直接返回 400「只有「进行中」的任务才能计时，请先把任务移到进行中」。实现为 `TimeLogService.startManual()`；`move` 的自动开表仍走 `start()`（那时任务还没落库到新列，走校验会读到旧列）。 |
| 回退到待处理 | `move` / `update` 把任务移回 `backlog` 时**关闭该任务上所有人的计时**，已记录的工时不删（`time_log` 原样保留）。 |
| 卡片上的计时控件 | 停止入口从右上角动作区移到 **meta 行的胶囊按钮**（`.timer-chip`，绿色，显示「计时中 48m」，点一下停止）；「开始计时」仍留在动作区（hover 出现）。待处理 / 已完成的卡片**不显示任何计时控件**，但历史记录的工时会照常显示。 |
| 任务清单 | 表格与 CSV 去掉「首次计时 / 最后计时」两列，只保留：完成日 / 任务 / 项目 / 负责人 / 分类 / 优先级 / 开始 / 总耗时。接口字段不变（`firstStartedAt` / `lastEndedAt` 仍返回，留给将来用）。 |

### 6. 补丁（v1.9）：任务清单补回「结束时间」列

上一版删「首次计时 / 最后计时」时，连带把首列的「完成日」也当成重复项去掉了，结果表里**没有"结束时间"这个字段**（用户指出）。

现在列固定为 8 列，开始与结束成对：

| # | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 列名 | 任务 | 项目 | 负责人 | 分类 | 优先级 | **开始时间** | **结束时间** | 总耗时 |

- `开始时间` = `startDate`（任务开始日期）
- `结束时间` = `completedAt`（任务完成日期）
- 两者目前都精确到**日**（与 `task.start_date` / `task.completed_at` 的字段类型一致）；要精确到时分需要给归档表加 `DATETIME` 字段并改任务表的类型，属另一次改动。
- CSV 表头同步为「开始时间 / 结束时间」，顺序一致。

### 7. 补丁（v2.0）：完成计时任务后自动接力 + 每天 8 小时口径确认

#### 7.1 完成后自动接力计时

**问题**（用户实测）：正在计时的任务被拖进「已完成」后，表停了，但「进行中」列还有别的任务，却没有任何一个在计时 —— 得手动再去点一次。

**规则**：`move` / `update` 把任务改到「已完成」时，先 `closeRunningForTask` 停表，再调 `TimeLogService.resumeInColumn(userId, workspaceId, fromColumn, finishedTaskId)`：

| 条件 | 行为 |
| --- | --- |
| 我当前**还有**运行中的计时（比如别的空间的任务） | **不接力** —— 不能把别的任务抢掉 |
| 刚完成的任务来自 `backlog` / `done` 列 | **不接力**（待处理列本来就不该计时） |
| 原列还有其他任务 | 按 `sort_order` 取**第一个**开始计时（复用 `start()`，含"个人同时只计一个"） |
| 原列没有剩余任务 | 不接力 |

`POST /api/tasks/{id}/move` 响应新增 `autoTimerTask`（接力上的任务名，没有则为 `null`），前端在完成提示后追加「· 已接着开始「X」的计时」。

**注意**：接力**不区分负责人** —— 列里第一个任务是谁的就给谁计时。因为计时记的是"我"的工时（我在做这件事），且用户要求"进行中必须有一个在计时"。这是刻意的取舍，写在 spec G.5。

#### 7.2 每天 8 小时是「整天合计」，不是「每个任务各 8 小时」

**确认：已经是整天合计口径**，代码在 `WorkTime.effectiveMinutes()`：

```java
int used = usedMinutesOn.applyAsInt(day);          // 当天已记录的工时
int quota = Math.max(0, MAX_MINUTES_PER_DAY - used); // 480 - used
total += (int) Math.min(minutes, quota);
```

而 `usedMinutesOn` → `sumMinutesByUserOnDate` 的 SQL 是：

```sql
SELECT COALESCE(SUM(minutes), 0) FROM time_log
WHERE user_id = #{userId} AND ended_at IS NOT NULL AND DATE(started_at) = #{date}
```

**只有 `user_id` 和日期**，不限 `task_id`、不限 `workspace_id` —— 所以同一天多个任务共用 480 分钟额度，跨空间也算在一起。

实测（`WorkTime` 单测）：同一天三个任务各 200 分钟 → 记 200 + 200 + **80** = 480；额度满后再计 → 0；换一天重新有 8 小时。

## 附录 · 2026-10-21 需求模块（v2.1 增量）

### 1. 层级

原来是两层（空间 → 项目 → 任务），现在补上第三层：

```
空间 workspace
 └─ 项目 requirement          （原有，界面上叫「项目」，/api/reqs）
      └─ 需求 requirement_doc  （本次新增，带富文本正文，/api/req-docs）
           └─ 任务 task.req_doc_id
```

迁移脚本 `sql/07_requirement_doc.sql`（幂等：建表 + `task` 加 `req_doc_id` 列与索引）。

### 2. 新接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/req-docs` | 需求列表。**不含完整正文**，只返回 `excerpt`（从 HTML 抽出的纯文本前 80 字）+ `reqName`（项目名）+ `taskCount`/`doneCount` |
| `GET /api/req-docs/{id}` | 需求详情，含 `content`（清洗后的 HTML） |
| `POST /api/req-docs` | 新建。body：`{reqId, title, content, status, owner}` |
| `PUT /api/req-docs/{id}` | 保存 |
| `DELETE /api/req-docs/{id}` | 删除：**先解绑关联任务**（`task.req_doc_id = NULL`），任务本身保留 |

任务侧：`TaskSaveRequest` 新增 `reqDocId`。保存时校验「需求必须存在、同空间、且属于任务所选的项目」，否则 400「所选需求不属于该项目」。切项目时前端会清空已选需求。

### 3. 正文安全（重点）

编辑器提交的是 HTML，**入库前在服务端用 jsoup 白名单清洗**（`RequirementDocService.sanitize`）：

- 允许：`p / br / h1-h4 / ul / ol / li / blockquote / pre / code / hr / b / strong / i / em / u / s / del / ins / a[href|title]`
  **+ 表格全套**（`table / thead / tbody / tr / th / td`，单元格合并 `colspan / rowspan`）
  **+ 图片**（`img[src|alt]`，http(s) 外链或 png/jpeg/gif/webp 的 data URL，单图 ≤3MB）
- 禁止：`script / iframe / object / embed / svg`、一切事件属性（`onclick` 等）；`style` 逐属性过滤，只留 `color / background-color / text-align`
- 链接只允许 `http / https / mailto` 协议
- 正文上限 **12MB**（列是 MEDIUMTEXT；粘贴截图以 base64 内联，200KB 会截断图片）；清洗后只剩空标签（`<p><br></p>`）时按 null 存

前端渲染时**再清洗一次**（`sanitizeHTML`），双保险。
> 清洗口径有独立单测口径验证：表格结构（含 colspan/rowspan）与 png data URL 放行，script / onclick / iframe / svg / `position` / `background-image` 全部拦截。

### 4. 编辑器

**SunEditor 2.47.3**（本地托管 `static/vendor/suneditor/`，进 `sw.js` SHELL 预缓存，不走 CDN，无构建）。

> 选型沿革：自建 `contenteditable + execCommand` 在长文档/多格式下选区不可靠（复制失效）→ 换 Quill 2 → **Quill 2 无原生表格支持，从 Word 粘贴的表格被拍平** → 最终换 SunEditor（原生表格 + 单文件 + 无构建）。历史数据里的 `li[data-list]` 属性保留兼容。

配置要点：`mode:"classic"`、`height:"auto"`（不内滚，内容多高编辑区就多高，靠整页滚动）、`minHeight:360px`、`resizingBar:false`、`showPathLabel:false`；工具栏含 `table`（表格插入/行列增删/合并单元格）。CSS 侧去掉全部边框（`.se-container`、`.se-wrapper` 无边框，正文区 `padding:18px 0 180px`），呈现为无边框整页书写。

### 5. 前端展示

- 看板卡片在分类标签后显示**需求名**（`.tag-doc`），点击 → 切到「需求」视图并打开那一份（不打开任务抽屉）。
- 任务抽屉新增「关联需求」下拉，按当前选中的项目过滤；未选项目时禁用并提示。

### 6. 连带处理

- 删除项目 → 该项目下的需求一并删除（`RequirementDocService.deleteByReq`），任务的项目与需求关联都清空。
- 循环任务派生的下一次任务继承 `reqDocId`（同一需求下的连续任务）。

## 附录 · 2026-10-26 分支管理（v3.2 增量）

### 1. 分支池：空间级公共分支 + 可选项目归属

分支池按空间维护，同时支持两种归属（`sql/31_branch_project.sql` 增量迁移）：

- `dev_branch.req_id` 为空 = **空间级公共分支**（历史数据默认落在这一档，行为与升级前一致）；
- `dev_branch.req_id` 非空 = **项目级分支**，直接归属 `requirement.id` 对应的项目。

不在分支上强制项目：主干、发布、跨项目的 feature 本来就会共用，强行切分会逼人重复建分支。
建任务时「所属分支」按当前项目过滤：直接归属该项目的分支 + 空间级公共分支（再按任务推导归属兜底），
避免不同项目的同名分支混在下拉里。表：`dev_branch` / `dev_branch_log`。

### 2. 状态与时间口径（两套，各管一件事）

状态：`dev`(开发中) → `testing`(待测试) → `merging`(待合并) → `released`(已发布)。
**允许任意方向切换**：现实里「待测试被打回开发中」很常见，强行单向只会逼人删分支重建、把历史丢掉。

| 记录位置 | 记什么 | 用途 |
| --- | --- | --- |
| `dev_branch.dev_at / test_at / merge_at / released_at` | **首次**进入该状态的时间（`COALESCE` 写入，回退不覆盖） | 算停留时长、发布周期（`released_at - created_at`） |
| `dev_branch_log` | **每一次**变更：动作、从哪到哪、谁、什么时候、附带说明 | 详情抽屉的操作记录；回答「谁把它退回了开发中」 |

新建时按初始状态盖上第一个时间点（默认 `dev` → `dev_at` = 创建时间），其余留空。
状态没变时不写日志（点错一次不该多一条噪音）。

### 3. 接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/branches` | 分支列表。`?project=` 时返回「直接归属该项目 + 空间级公共分支」：公共分支按任务推导归属过滤，尚未关联任何任务的公共分支对所有项目可见；附带 `taskCount` / `doneCount`（排除回收站任务、只统计可见项目）与 `projects` 推导标签；排序 `FIELD(status)` + `updated_at DESC` |
| `GET /api/branches/{id}` | 详情（同一个实体） |
| `GET /api/branches/{id}/logs` | 状态变更时间线，倒序 |
| `GET /api/branches/{id}/tasks` | 挂在分支上的未删除任务（未完成在前） |
| `POST /api/branches` | 新建。body：`{name, status?, reqId?, targetBranch?, owner?, ownerUserId?, note?}`；`reqId` 空 = 空间级公共分支 |
| `PUT /api/branches/{id}` | 改基础信息（名字 / 所属项目 / 负责人 / 目标分支 / 备注）。**`status` 字段被忽略**；`reqId` 传空串表示退回空间级公共分支，不传（`null`）表示不改 |
| `POST /api/branches/{id}/status` | 改状态。body：`{status, note?}`。唯一会写时间点与时间线的入口 |
| `DELETE /api/branches/{id}` | 删除：先解绑任务（`task.branch_id = NULL`，任务保留），再删时间线与分支 |

校验口径：

- 分支名 `^[\p{L}\p{N}._/-]{1,80}$`（字母含中文、数字、点、下划线、中划线、斜杠；空格与 `@{}~^:?*[\` 本来 git 也不接受），同一归属维度内**唯一**（同项目不允许同名，不同项目允许；空间级公共分支之间不允许同名）；
- `reqId` 非空时必须是**本空间**的项目，否则 400「所属项目不存在」；
- `targetBranch` ≤80、`note` ≤200；
- 不填负责人 = 当前用户（与需求模块一致）。

> 为什么把「改状态」单独开一个接口：如果允许 `PUT` 顺手改 `status`，就会出现「改了状态但没走时间线/时间点」的
> 数据，统计和追溯立刻对不上。编辑弹窗里因此**不显示状态字段**。

### 4. 任务侧

`TaskSaveRequest` 新增 `branchId`（选填）；`task` 表加 `branch_id` + 索引（`sql/14`）。
保存时校验「分支存在且同空间」，否则 400「所选分支不存在」。连带处理：

- 删除分支 → 关联任务解绑（任务本身保留）；
- 删除项目 → 直接归属该项目的分支退回空间级公共分支（`req_id = NULL`，分支与任务关联保留）；
- 循环任务派生的下一次任务**继承** `branchId`（长期任务通常还在同一条分支上）；
- 清空空间数据（`WorkspaceService.wipeData`）→ 分支与时间线一起清掉。

### 5. 前端

- 侧栏新增「分支」（`data-view="branches"`），角标 = 还没发布的分支数（开发中 + 待测试 + 待合并）；
- 视图顶部五个格子：四档状态计数（点击只看这一档，再点取消）+ 平均发布周期（已发布分支 `released_at - created_at` 的均值）；
- 四列分组卡片：状态徽章点开浮层可切四档 + 编辑 / 删除；卡片右下角显示当前状态已停留多久（已发布的分支改显示总周期）；
- 点卡片打开右侧抽屉：状态分段、四个状态时间点、目标分支 / 负责人 / 创建时间 / 任务进度、归属项目、关联任务（点击打开任务抽屉）、操作记录时间线；
- 新建 / 编辑弹窗增加「所属项目」（空 = 空间级公共分支）；
- 顶部项目过滤器（全部项目 + 本空间可见项目），支持按状态、按项目两种分组；项目分组优先用直接归属，历史分支回退到任务推导归属；
- 任务抽屉「所属分支」下拉按当前项目过滤（直接归属 + 空间级公共分支），切换项目时随之刷新；
- 看板卡片在分类/需求标签后显示分支名（`.tag.tag-branch`），只读展示，点击跳转留给「分支」页。

自检：`node tools/shots/check-branch.mjs`（CDP 真 Chrome，25 项：进视图、四列渲染、统计筛选、状态浮层、编辑弹窗、
抽屉各区块、看板分支标签、任务抽屉下拉分组与回填）。

---

## 附录 · 2026-10-30 甘特图 V1.4 / V2.0（增量）

> 迁移脚本：`sql/15_gantt_v2.sql`、`sql/16_gantt_index.sql`（均幂等）。
> 口径：任务筛选与 `/api/tasks/list` 完全一致；扩展字段（子任务/工时/标签/评论）同 `/api/board`，
> 但只为本页任务补齐。

### 1. 任务分页（SQL 区间分页）

`GET /api/gantt`（登录）

参数：与 `/api/tasks/list` 相同的 `workspace/q/owners/pris/cats/reqs/tags/due/focus/blocked/noDue`，
另加：

| 参数 | 说明 |
|---|---|
| `from` / `to` | `yyyy-MM-dd`，按「与区间有交集」在 SQL 层过滤已排期任务；不传=全部排期任务 |
| `includeDone` | 默认 `true`；传 `false` 时 SQL 直接排除已完成列 |
| `offset` / `limit` | 稳定分页；`limit` 默认 300，上限 2000（前端按 500/页自动加载） |

返回：

```json
{ "items": [{...任务}], "total": 415, "offset": 0, "limit": 500, "hasMore": true,
  "unscheduledCount": 3,
  "unscheduled": [{...任务}],
  "deps": [{ "id": "D...", "fromTaskId": "K1", "toTaskId": "K2", "depType": "FS", "lagDays": 0 }],
  "baseline": { "K1": { "startDate": "2026-10-01", "dueDate": "2026-10-08" } },
  "baselineAt": "2026-10-28T18:00:00" }
```

- `total` / `items` 只统计**已排期**任务；未排期任务单独放在 `unscheduled`（最多 200 条，总数见 `unscheduledCount`），
  `deps` / `baseline` / `baselineAt` 与 `unscheduled` 都只随第一页（`offset=0`）返回。
- 区间相交：`LEAST(COALESCE(start,due), COALESCE(due,start)) <= to AND GREATEST(...) >= from`，
  由生成列 `task.gantt_start / gantt_end` 承载（`sql/16`），走 `idx_gantt_range`。
- 排序稳定：`gantt_start, gantt_end, id`。
- `q` 在 SQL 中覆盖：标题/描述/备注/分类子串匹配（`LOCATE`，避免 `%`/`_` 被当通配符）+ 项目名 / 标签名 / 附件文件名 EXISTS，与看板 `match()` 对齐。
- `due` 的 over/today/soon、`focus`、`blocked`、`noDue`、负责人/优先级/分类/项目/标签同样在 SQL 层过滤。
- 前端：月视图把 `from/to` 下推并翻月重新查询；「适配全部」不带区间，按 500/页加载排期任务。
- 任务新增 `isMilestone` 字段：`POST/PUT /api/tasks` 可传；旧客户端更新时未传则保留原值，里程碑日期在服务端归一为单日。

### 2. 依赖

- `GET /api/gantt/deps` → 全部依赖（空间级）
- `POST /api/gantt/deps`，body `{"fromTaskId":"A","toTaskId":"B","depType":"FS","lagDays":0}`
  - 校验：同空间、非自环、同边不重复、不产生环、总量上限 5000；失败返回业务错误（HTTP 200 + `code!=0`）
- `PUT /api/gantt/deps/{id}`，body `{"depType":"SS","lagDays":2}`（改类型/滞后）
- `DELETE /api/gantt/deps/{id}`

历史 `blocked_by_task_id` 会在迁移脚本中幂等转成 FS 依赖；新依赖不再回写该字段。

### 3. 基线

- `POST /api/gantt/baseline` → 快照当前所有有日期任务的计划起止，返回 `{baseline, baselineAt}`（覆盖旧基线）
- `GET /api/gantt/baseline` → 同上（只读）
- `DELETE /api/gantt/baseline` → 清除

### 4. 资源负载

`GET /api/gantt/load?from=yyyy-MM-dd&to=yyyy-MM-dd`（筛选参数同上）

```json
{ "from": "2026-10-05", "to": "2026-11-09",
  "weeks": ["2026-10-05", "..."],
  "members": [{ "name": "我", "buckets": [
    { "weekStart": "2026-10-05", "estimateMinutes": 600, "actualMinutes": 400, "capacityMinutes": 2400 }
  ]}]}
```

- 预估工时按任务区间内**工作日**（跳周末）摊到周；实际工时按 `time_log.started_at` 归周、按计时人汇总。
- 容量固定 5×8h；不包含法定节假日。

### 5. 只读分享

- `GET /api/gantt/share` → 当前分享 `{token, expiresAt}` 或 `null`（**仅空间主**：token 本身就能公开读取，不能发给普通成员）
- `POST /api/gantt/share` → 生成/重置（30 天有效，**仅空间主**）
- `DELETE /api/gantt/share` → 停止分享（仅空间主）
- `GET /api/share/gantt?token=...` → **公开、无需登录**；只读快照，任务走白名单 DTO（id/标题/负责人/优先级/列/起止/进度/里程碑/阻塞/估时/实际工时），并返回该空间的四档优先级显示配置；依赖与基线只返回可见任务之间的；token 由 `SecureRandom` 生成（32 位 base64url），无效或过期返回 404。

页面：`/share.html?token=...`（独立只读甘特页，无写操作）；文档分享为 `/share.html?token=...&kind=doc`。

---

## 附录 · 权限矩阵（2026-10-31）

空间角色：`owner`（空间主）/ `member`（普通成员）。个人空间里本人恒为 owner。

| 操作 | 接口 | owner | member |
| --- | --- | --- | --- |
| 任务增改、移列、计时、评论、附件 | `/api/tasks/**`（除 purge） | ✓ | ✓ |
| 任务移入回收站 / 恢复 | `DELETE /api/tasks/{id}`、`POST .../restore` | ✓ | ✓ |
| **彻底删除任务** | `DELETE /api/tasks/{id}/purge` | ✓ | 403 |
| 项目（需求分组）增改 | `/api/reqs`、`PUT /api/reqs/{id}` | ✓ | ✓ |
| **删除项目（连带需求文档）** | `DELETE /api/reqs/{id}` | ✓ | 403 |
| 需求文档增删改 | `/api/req-docs/**` | ✓ | ✓ |
| 分支增改、状态流转 | `/api/branches/**`（除 DELETE） | ✓ | ✓ |
| **删除分支** | `DELETE /api/branches/{id}` | ✓ | 403 |
| 看板列/分类/优先级显示配置增改 | `/api/columns`、`/api/categories`、`/api/priorities` | ✓ | ✓ |
| 删除看板列/分类 | `DELETE /api/columns/{id}`、`/api/categories/{id}` | ✓ | 403 |
| 甘特依赖增删改、基线拍摄 | `/api/gantt/deps*`、`POST /api/gantt/baseline` | ✓ | ✓ |
| **清除基线** | `DELETE /api/gantt/baseline` | ✓ | 403 |
| 只读分享生成/查看/撤销 | `/api/gantt/share` | ✓ | 403 |
| **导出全量备份** | `GET /api/export` | ✓ | 403 |
| 导出任务 CSV | `GET /api/export/csv` | ✓ | ✓ |
| **导入覆盖 / 清空数据** | `POST /api/import`、清空接口 | ✓ | 403 |
| 通知推送配置/测试 | `/api/notify/**` | ✓ | 403 |
| 成员、邀请、空间设置 | `/api/workspaces/**` 写操作 | ✓ | 部分只读 |
| 账号管理 | `/api/admin/**` | 平台管理员 | 403 |

约定：越权仍返回 `code=403` 的业务错误体（HTTP 200），未登录返回 HTTP 401。

迁移：执行 `sql/17_perf_index.sql`（幂等）后再启动新 jar —— 需求列表依赖 `requirement_doc.content_brief` 列。

> 部署提示：v6 备份可能包含需求文档正文（含内嵌图片），`deploy/nginx-hourglass.conf` 已给 `POST /api/import` 单独放宽到 128 MB；若自行改过 nginx 配置，请同时确认 `client_max_body_size` 与 `proxy_read_timeout`。

---

## 附录 · 2026-11-01 BUG-12：通知开关拆分与删除口径（增量）

### 1. 接口契约变化

| 接口 / 字段 | 变化 |
| --- | --- |
| `PUT /api/workspaces/{id}` | 新增可选布尔 `notifyInAppEnabled`（站内通知开关，NULL/不传=保持原值；新空间默认启用）。与 `notifyEnabled`（外部渠道开关）相互独立：关闭外部渠道不会连带停掉站内提醒/汇总。 |
| `GET /api/notify/status` | 新增 `inAppEnabled`（布尔，默认 true）与 `inAppSource`（`default` / `workspace`）。 |
| `POST /api/notify/test` | 语义不变：仍然只走外部渠道，且受 `notifyEnabled` / `app.notify.enabled` 控制；站内开关不影响测试结果。 |
| `GET /api/tasks/{id}/logs` | 口径明确：回收站中的任务仍可读时间线（与评论一致）；已物理删除的任务 404。 |
| 任务写接口（PUT / move / reopen / delete / restore / purge） | 统一走 `requireTask`：未删除任务接口看不到回收站任务，恢复/彻底删除只接受回收站任务，错误文案统一为「任务不存在」/「回收站中没有该任务」。 |

### 2. 提醒闭环行为

- 外部渠道与站内通知各看各的开关：外部关、站内开 → 站内提醒照常写 `app_notification`。
- 两者都关闭时，到点的 `remind_at` 仍会标记为已处理（避免永久重试），只写应用日志，不再向任务时间线插入 `actor=null` 的记录。
- 每个账号仍是"同一收件人 + 同一任务 + 同一类型 6 小时内去重"。

### 3. 数据库

- 新增 `sql/21_notify_split.sql`（幂等）：`workspace.notify_in_app_enabled TINYINT(1) NULL`。

### 4. 权限矩阵约定修正

越权现在返回 **HTTP 403**（响应体 `code=403`），与第十轮 HTTP 状态码统一一致；未登录仍为 HTTP 401。

## 附录 · 2026-11-01 OPS-2：AI / webhook 出站连接池

- 行为契约不变；仅底层传输改为共享连接池（Apache HttpClient 4.5）。
- 超时口径：webhook 连接 2s / 读 3s（不跟随重定向）；AI 连接 10s / 读 90s。
- AI 单次调用总预算 150s（含 `response_format` 降级重试）；nginx `location /api/ai/` 的 `proxy_read_timeout` 保持 200s，两侧对齐后前端不会先收到 504。
- 并发上限不变：AI 同时最多 2 个上游请求，超出返回业务错误「AI 正忙」。

## 附录 · 2026-11-01 IA-4 / IA-5 / IA-7（增量）

- `GET /api/calendar` 新增筛选参数：`q`、`owners`、`pris`、`cats`、`reqs`、`tags`、`due`、`focus`、`blocked`（与看板同名同义）。响应结构不变。
- `GET /api/review` 的 `workMinutes` 新增 `mineWeek`（我在本周期内的工时，分钟）；原 `space` / `mine` / `spaceWeek` 不变。
- 页面入口：侧栏不再直接提供「回收站」「用户管理」，分别并入「设置 → 数据」「设置 → 账号」；旧地址 `#/trash`、`#/users` 仍可用（自动跳到设置对应 tab）。

## 附录 · 2026-11-01 IA-3：我的任务收件箱（增量）

`GET /api/my-tasks` 参数扩展（全部可选，语义与看板同名参数一致）：

| 参数 | 说明 |
| --- | --- |
| scope | `open`（默认，排除已完成）/ `all` |
| q | 标题 / 描述 / 备注 / 分类子串（不区分大小写） |
| pris / cats / reqs / tags | 逗号分隔多选；`reqs` 支持 `__none` |
| blocked | `true` 只看被阻塞 |

- 负责人维度固定为"我"，`owners` 参数被忽略。
- SQL 改为显式 JOIN `workspace_member`，默认 `LIMIT 200`；返回结构不变（`items` / `total` / `spaces` / `matchedByNameOnly`）。
- 前端行内完成 / 计时 / 改期使用显式 `workspace` 的写请求（`API.postWs` / `putWs`），不要求先切换空间。

## 附录 · 2026-11-01 IA-2 / IA-1（增量）

- `/api/projects` 与 `/api/reqs` 完全等价（GET / POST / PUT / DELETE，路径参数 `{id}`），语义、权限、返回结构一致；表名仍为 `requirement`。
- 页面入口：
  - 「项目」页合并需求文档的查看入口，侧栏不再单独提供「需求」。
  - 「任务清单 / 报表 / 流程体检」合并为「分析」页的三个 tab；旧 hash `#/completions`、`#/stats`、`#/flow` 自动跳转到对应 tab。
- 后端 `MetricsService` 统一逾期 / 工时 / 列计数的聚合口径；`/api/stats` 返回结构不变。

## 附录 · 2026-11-01 TOP-6：我的任务分页（增量）

`GET /api/my-tasks` 新增分页参数，响应在原有字段上增量扩展（老客户端不传新参数照常工作）：

| 参数 | 说明 |
| --- | --- |
| offset | 默认 `0`；负数按 `0` 处理 |
| limit | 默认 `200`，上限 `500`（超出按 500 截断；小于 1 按 1 处理） |

响应字段：

| 字段 | 说明 |
| --- | --- |
| items | 本页任务（扩展字段与之前一致：`tags` / 子任务计数 / 工时 / 评论数 / `workspaceName`） |
| total | 当前筛选条件下的**全量**条数（独立 `COUNT`，不是本页条数） |
| offset / limit | 服务端实际生效的分页参数（已收敛到上限） |
| hasMore | `offset + items.length < total` |
| truncated | 兼容字段，等同 `hasMore`（旧前端用它提示"仅显示前 200 项"） |
| spaces | 覆盖空间列表 `[{id,name}]`，按全量统计去重，分页不会缩水 |
| matchedByNameOnly | 全量中"仅按显示名匹配、未绑定账号"的条数（用于提示跑 sql/04） |

- 列表 / 计数 / 覆盖空间三条 SQL 复用同一个 `myTasksWhere` 片段，筛选口径不会漂移。
- 排序在原有 `(due_date IS NULL), due_date, FIELD(priority), updated_at DESC` 后追加 `t.id`，保证同一 `updated_at` 下翻页边界稳定。
- 前端「我的任务」底部提供「加载更多」，按 `offset = 已加载条数` 追加；分组（逾期/今天/本周/以后）、行内完成/计时/改期、空间与顶栏筛选保持不变。

## 附录 · 2026-11-01 BE-ARCH-1：后端服务拆分（无接口变化）

- `TaskService` 拆为 `TaskQueryService`（看板/列表/日历/我的任务/扩展字段）、`TaskCommandService`（新建/编辑/标签与关联校验）、`TaskWorkflowService`（移动/循环任务/计时联动/完成归档）、`TaskTrashService`（回收站/恢复/彻底删除/过期清理）。
- HTTP 契约完全不变：路径、参数、返回 JSON、ETag、权限、备份 v6、分批事务均保持原样；原 `TrashService` 的每日清理任务并入 `TaskTrashService`。
- 仅供排障参考：移动类写操作（拖拽与抽屉改列）现在都走 `TaskWorkflowService`，查询类只读走 `TaskQueryService`。

## 附录 · 2026-11-01 CODE-5：前端 ES Module 化（无接口变化）

- `app.js` 拆为 `js/main.js` + `js/core/*` + `js/lib/*` + `js/views/*`，零构建、原生 `import` / 动态 `import()`；`index.html` 使用 `<script type="module">` 与 `modulepreload`。
- 低频视图（甘特 / 项目 / 需求 / 周回顾 / 分析 / 设置 / 个人设置）首次进入时才加载；首屏只加载看板、列表、日历、我的任务、分支与抽屉。
- 接口路径、参数、返回结构、ETag 与 SSE 行为均未改动；`share.html` 仍使用独立的 `share.js`。
- `sw.js` 缓存名升至 `devstudio-shell-v73`，预缓存清单覆盖全部模块文件；`tools/check-assets.js` 会递归校验 import 图。

## 附录 · 2026-11-06 通知机制优化（增量）

### 1. 新增接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/tasks/{id}/watch` | 当前用户对该任务的关注状态：`{"watching":true,"count":3}`；`count` 为全部关注人数 |
| `POST /api/tasks/{id}/watch` | 关注（幂等）；任务须可见，回收站中的任务返回 400 |
| `DELETE /api/tasks/{id}/watch` | 取消关注（幂等） |
| `GET /api/tasks/{id}/mention-candidates` | `@提及`候选：只返回**对该任务所在项目可见**的空间成员，被设为不可见的成员不会出现 |
| `POST /api/tasks/{id}/comments` | body 新增可选 `mentionUserIds`（最多 20 个）；与正文里的 `@名字` 取并集去重，重名成员也能精确通知。非空间成员 ID 会被忽略 |

### 2. 通知偏好事件

`GET/PUT /api/auth/notification-preferences` 按**事件类型 × 投递通道**配置：每类事件有站内、邮件两个开关，缺省站内开启、邮件关闭；投递时逐人逐类校验，关闭的通道不再投递。

| 事件类型 | 含义 | 邮件 |
| --- | --- | --- |
| `task_assigned` | 任务创建或负责人变更后指派给我 | 可开 |
| `task_comment` | 我负责的任务有新评论，或评论中被 @ 提及（评论与 @ 合并为一个开关） | 可开 |
| `task_watch` | 我关注的任务有新评论、移入回收站或恢复 | 可开 |
| `task_updated` | 我负责的任务字段变更、移列、移入回收站或恢复 | 可开 |
| `demand_status` | 需求与版本动态：我提交的需求、负责的文档与分支状态变化，或所在版本发布/删除（合并为一个开关） | 可开 |
| `daily_digest` | 每日站内任务汇总，**只有站内一种投递方式**（设置页邮件列显示 `—`）；关闭后每日汇总不再写站内通知，任务级提醒不受影响 | 不可 |

- 系统/安全通知（`member_role`、`member_removed`、`project_access`）不受个人偏好控制，站内必投。
- 早期的细粒度类型（`task_mention`、`doc_changed`、`branch_status`、`version_released`、`version_deleted`）已合并为 `task_comment` 与 `demand_status`；前端仍保留旧类型图标映射，历史通知记录可正常展示。

### 3. 行为变化

1. **评论通知分层**：被 @ 的人优先收到 `task_comment` 通知；负责人若已被 @ 就不再重复收评论通知；任务关注者收到评论、移入回收站/恢复通知。字段编辑与移列不再单独通知关注者（每次保存都会产生，属于高频打扰），操作者本人永远不会收到自己触发的通知。
2. **通知中心聚合**：前端把**同一任务 + 同一类型**的连续通知合并为一条（显示 `×N`），点击时整组标为已读；接口仍返回原始通知列表，聚合只发生在前端。
3. **站内通知保留期**：每天 03:20 清理超期 `app_notification`，默认 90 天，可用 `app.notification.retain-days`（环境变量 `NOTIFICATION_RETAIN_DAYS`）调整；跨空间统一执行，不影响 `task_log` 审计记录。
4. **邮件深链**：配置 `app.mail.base-url`（含 context-path，如 `https://host/hourglass/`）后，任务类通知邮件正文追加 `#/board?task=<id>` 深链；新建账号的欢迎邮件追加登录地址。未配置时不附链接，避免出现半截地址。
5. **关注关系清理**：任务彻底删除、清空空间、覆盖导入、账号删除、成员退出/被移出空间都会一并清理 `task_watch`；任务移入回收站时关注关系保留，恢复后继续生效。重新加入空间后需重新关注。

### 4. 数据库

- 新增 `sql/36_task_watch.sql`（幂等）：`task_watch(task_id, workspace_id, user_id, created_at)`，主键 `(task_id, user_id)`，索引 `(user_id, workspace_id)` 与 `(workspace_id, task_id)`；沿用项目"零外键"约定，由应用层级联清理。

### 5. 未做 / 边界

- 通知聚合不做服务端合并，接口返回条数上限不变。
- @提及候选接口一次读取项目可见范围配置后在内存判定，不再逐成员回查。
- 本附录取代此前「评论不做 @提及与提及通知」「评论仍不做 @提及」的边界说明。

## 附录 · 文档模块增强（评论 / 版本对比 / 全文检索）

### 1. 新增接口

- `GET /api/req-docs/{docId}/comments`：文档评论列表（按时间正序）。
- `POST /api/req-docs/{docId}/comments`：发表评论；`content` 必填，`quoteText` 可选（批注上下文）。
  - 权限：能查看文档且空间角色不是 `viewer` 即可发表。
  - 删除：`DELETE /api/req-docs/{docId}/comments/{commentId}`，仅评论作者或项目可写者可删。
- 历史版本弹层增加「与当前对比」与「文本差异」：纯前端能力，左侧渲染当前文档正文，右侧渲染选中的历史版本正文；文本差异按行高亮新增/删除内容（上限 1200 行）。
- 历史快照在正文保存前生成（保存的是被替换掉的旧正文），恢复版本前也会先为当前正文留一版；每篇文档最多保留最近 20 版。

### 2. 全文检索

- `GET /api/req-docs?keyword=...` 列表搜索升级：
  - 关键词长度 ≥ 2 时走 MySQL `FULLTEXT INDEX ft_doc_fulltext(title, content_brief, content) WITH PARSER ngram`，按相关度排序。
  - 单字符关键词仍回退到 `LIKE` 标题与正文，避免 ngram 无法命中。
- 新增迁移 `sql/40_doc_fulltext.sql`（幂等：information_schema 判断 + PREPARE 动态执行，可重复跑）。

### 3. 数据库

- 新增 `sql/39_doc_comments.sql`：`req_doc_comment(id, workspace_id, doc_id, user_id, content, quote_text, created_at, updated_at)`，索引 `(doc_id, created_at)`。
- `sql/baseline/01_schema_full.sql` 同步包含 `req_doc_comment` 表与 `requirement_doc.ft_doc_fulltext` 全文索引。

### 4. 未做 / 边界

- 评论支持「引用选中」批注：在正文中选中内容后点「引用选中」，随评论携带 `quoteText`（≤500 字，前端截断）作为批注上下文；评论列表以引用块展示。暂不支持 @提及、图片附件与锚定段落级的批注定位（引用是选中时的文本副本，不随正文修改联动）。
- 文本差异按行对比，未做行内字符级高亮；超过 1200 行时降级为提示。
- 全文检索依赖 MySQL ngram 解析器；若部署环境未启用 ngram，需先确认 `SHOW PLUGINS` 中 ngram 状态。

## 附录 · 文档草稿/发布与只读分享（2026-11-06）

### 1. 可见性模型（两态）

- `requirement_doc.published_at` 非空 = **已发布**，按项目可见范围对成员开放；为空 = **草稿**，仅文档作者与空间 owner/admin 可见，其余人一律按 404 处理（不泄露存在性）。
- 新建文档默认草稿；存量文档由迁移回填为 `created_at`，线上行为不回退。
- 校验口径收敛在 `RequirementDocService.canSeeDraft`（静态方法，评论等旁路共用同一口径）；列表、详情、评论、活动、历史全部走草稿过滤。

### 2. 新增接口

| 接口 | 说明 |
| --- | --- |
| `PUT /api/req-docs/{id}/publish` | 发布 / 收回发布。body：`{published: true/false}`；仅文档作者或项目可写者，其余 403 |
| `GET /api/req-docs/{id}/share` | 查看现有分享链接（能看文档即可）；已过期按无链接返回 `null` |
| `POST /api/req-docs/{id}/share` | 生成/重置分享链接（30 天有效）；文档须已发布（否则 400），权限同发布 |
| `DELETE /api/req-docs/{id}/share` | 撤销分享链接（立即失效） |
| `GET /api/share/docs?token=...` | **公开、无需登录**（`GET /api/share/**` 已放行）；只返回白名单 DTO（正文与展示字段，不含评论/历史/内部 ID）；token 无效、过期或文档已收回发布 → 404 |

### 3. 数据库

- 新增 `sql/42_doc_publish_share.sql`（幂等）：
  - `requirement_doc` 加 `published_at DATETIME NULL`；回填 `= created_at` 绑定在列创建事件上（`@x = 0` 守卫），重复执行不会把已收回的草稿重新发布。
  - `req_doc_share(workspace_id, doc_id, token, created_at, expires_at)`，主键 `(workspace_id, doc_id)`（每文档一条），`UNIQUE KEY uk_token(token)`；沿用"零外键"约定。
- `sql/baseline/01_schema_full.sql` 同步列与表；两个种子脚本尾部把种子文档回填为已发布。
- 清理点：文档删除、项目删除（连带）、空间清空/覆盖导入都会删 `req_doc_share`（TaskCascade 注册表已同步，快照测试覆盖）。

### 4. 未做 / 边界

- 分享只含正文快照，不含评论、历史版本与工作项关联；正文在分享页仍走 DOMPurify 清洗后渲染（markdown 本地渲染）。
- 分享令牌 30 天固定有效，可随时重置/撤销；不做密码、按次访问或只读快照冻结。
- 收回发布后已生成的分享链接立即失效（公开接口校验 `published_at`）；重新发布会恢复同一 token 的有效性，如需彻底作废请点「停止分享」。
- 草稿可见性不做按成员白名单（评估后放弃）：只做作者 + 空间管理员两档，保持权限模型简单。
- 草稿的「作者」指 `owner_user_id`（创建时落当前用户）。通过 API 保存时若把负责人改为无账号绑定的名字，草稿将只有空间 owner/admin 可见（界面无此入口）。
- 备份/覆盖导入携带 `published_at` 往返；旧备份文件没有该字段，导入时按已发布回填（同 sql/42 迁移口径），分享 token 不随备份迁移（导入后需重新生成）。
