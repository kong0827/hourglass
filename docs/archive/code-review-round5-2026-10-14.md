# 第五轮代码审查（2026-10-14）

## 结论与范围

基于第四轮修复后的当前版本继续审查，发现 6 项问题：1 项 P1、4 项 P2、1 项 P3。其中管理员保护和推送判断是上一轮修复仍未覆盖的路径，其余为本轮进一步发现的现有问题，不将其未经证据地认定为最近修改引入。

只新增本报告，没有修改业务源代码。用户明确接受的会话不踢线、任务最后写入生效且无冲突 UI、JSON 非全量恢复、文件与数据库无补偿，以及计时并发窗口，继续按现状处理，不列为缺陷。

## 发现

### 1. [P1，修复遗漏] 管理员锁的分支依据旧角色，角色在读取后变化时仍可清掉最后一名管理员

- 位置：`src/main/java/com/hourglass/kanban/service/UserService.java:134`、`:135`、`:137`、`:143`；`src/main/resources/mapper/UserMapper.xml:37`。
- 触发顺序：原先只有管理员 A，U 是普通用户。请求 R 开始保存 U 的显示名/角色，非锁定读取到 U=user 后暂停；另一请求将 U 升为管理员，随后将 A 降为普通用户，此时 U 是唯一管理员；R 继续把 U 的旧角色 user 写回。
- 原因：新加的 `lockAdmins` 仅在“此前读取的 u 是 admin，且请求明确改成 user”时调用。R 的快照里 u=user，因此完全不进入锁分支。mapper UPDATE 始终写 role；即使请求省略 role，保存显示名也会写回读取时的旧角色。
- 影响：最终没有管理员。原来的两个管理员同时降权路径已有锁保护，但“读取普通用户后发生提升”及角色字段随显示名保存的路径仍可绕过约束。该问题属于账号权限不变量，不属于已接受的任务并发覆盖。
- 验证：使用当前编译的 `UserService.update` 和模拟 mapper，把上述角色变化插入第一次非锁定读取之后，结果为 `admins_after_stale_user_update=0, admin_lock_calls=0`。探针只验证服务分支及写入顺序，未执行真实 MySQL 事务；普通 SELECT 不锁行、UPDATE 无条件写 role 的 SQL 也已核对。
- 建议：所有可能写角色的请求使用统一的事务内约束，锁定后读取当前角色并判断，避免依赖之前的快照。仅修改显示名时不要写角色。锁定顺序应统一，实际数据库并发验证需覆盖提升、降权、删除及显示名保存交错。

### 2. [P2] 密码按字符数校验，允许 bcrypt 静默忽略超出 72 字节的部分

- 位置：`src/main/java/com/hourglass/kanban/dto/UserCreateRequest.java:19`；`src/main/java/com/hourglass/kanban/dto/PasswordResetRequest.java:14`；`src/main/java/com/hourglass/kanban/dto/PasswordChangeRequest.java:18`；`src/main/java/com/hourglass/kanban/config/SecurityConfig.java:24`；`src/main/java/com/hourglass/kanban/service/UserService.java:159`、`:207`。
- 触发：设置“24 个中文字 + A12345”为密码，共 30 个字符、78 个 UTF-8 字节，满足现有 6–64 字符校验。
- 原因：当前 BCryptPasswordEncoder 使用 bcrypt 的 72 字节有效输入限制，校验只检查字符数。多字节字符会提前耗尽有效输入，后缀未参与密码匹配。
- 影响：把 A12345 换成 B12345 后仍能匹配原密码；用户可能以为已通过修改后缀更换密码，实际有效凭据未改变。此问题涉及新登录/密码匹配，不是已接受的旧会话继续有效。
- 验证：使用本项目实际依赖中的 BCryptPasswordEncoder 编码前者、匹配后者，得到 `password_chars=30, utf8_bytes=78, altered_suffix_matches=true`。使用无害构造字符串，没有读取真实密码。
- 建议：在创建、重置、修改及首启明文密码入口统一校验 UTF-8 字节长度不超过 72，并给出清晰错误。处理已有长密码时明确重置路径；若采用其他编码方案，需要带版本标识和迁移兼容，不能直接改变所有现有哈希的解释方式。

### 3. [P2，修复遗漏] 推送成功码仍由正则扫描任意正文，HTML 或嵌套错误响应仍可被误判

- 位置：`src/main/java/com/hourglass/kanban/service/NotificationService.java:43`、`:44`、`:292`、`:306`；任务提醒标记位于 `:113`。
- 触发：渠道或网关返回 HTML，其中脚本或缓存数据含 `"code":200`；或返回 `{"details":{"code":200},"code":500}`。
- 原因：上一轮把“找不到错误码也算成功”改成“找到成功码才算成功”，但依然对任意字符串使用正则，取第一个匹配，并未解析顶层 JSON。正则还会把 `{"code":0.5}` 中的整数前缀 0 当成功码。
- 影响：错误响应仍可能触发已发送标记，提醒不再重试，与文档“HTML 错误页不判成功”的说明不一致。简单的不含状态码 HTML 已能正确拒绝，该部分修复有效。
- 验证：调用当前 `channelAccepted`，以上 HTML、嵌套成功码加顶层 500、Server酱 code=0.5 的三个样例都返回 true。没有向任何推送服务发送请求。
- 建议：使用 JSON 解析器，要求响应是对象，并按渠道协议读取顶层状态码、校验其完整数值和类型；拒绝 HTML、无状态码、非整数及协议不符响应。保留现有固定端点和禁止重定向的保护。

### 4. [P2] 日历翻月没有请求代次保护，迟到响应会把当前月份切回去

- 位置：`src/main/resources/static/js/app.js:1827`、`:1832`；翻月入口为 `calShift`。
- 触发：10 月日历请求未完成时，点击下一月并发出 11 月请求；11 月先返回，10 月稍后返回。
- 原因：每个响应都无条件覆盖 calYear、calMonth 和 calTasks，没有像看板 loadSeq 一样检查是否仍属于当前请求。
- 影响：已显示 11 月后又退回 10 月，任务列表也变回旧月；再点下一月可能重复进入同一月，影响导航和任务定位。旧请求失败也会覆盖新请求成功后的界面。
- 验证：提取当前 `loadCalendar/calShift` 在 Node 中运行，控制两次请求完成顺序，得到 `calendar_after_new_then_old_response=2026-10, task=OCTOBER`。
- 建议：记录请求代次与目标年月，成功及失败分支都只处理当前请求。取消旧请求可作为优化，但仍需对迟到结果做检查。列表排序请求也具有类似的无代次结构，可在实现修复时一并核对。

### 5. [P2] SSE 空间隔离只在浏览器过滤，其他账号仍收到个人空间的活动事件

- 位置：`src/main/java/com/hourglass/kanban/controller/SseController.java:20`；`src/main/java/com/hourglass/kanban/service/SseService.java:21`、`:23`、`:52`；`src/main/java/com/hourglass/kanban/config/ChangeBroadcastFilter.java:46`；`src/main/resources/static/js/app.js:2824`。
- 触发：账号 B 登录并订阅 `/api/events`；账号 A 在自己的个人空间修改任务。
- 原因：SSE 订阅没有记录用户或空间，所有 emitter 共用一个集合，任何变更都把 workspace ID 发给所有连接。前端收到后再按当前空间过滤，这只能减少刷新，不能实现服务端数据隔离。
- 影响：B 能观察无权访问的个人/共享空间 ID 及变更发生的时间与频率。事件目前没有任务内容，因此本轮不宣称能通过 SSE 读取任务标题或详情；普通数据接口的空间权限校验也仍然存在。
- 验证：当前 SseService 建立两个订阅，广播假个人空间标识，读取 emitter 的待发送事件，两个订阅都含该标识，`unrelated_subscriber_B_received_private_space=true`。控制器允许任何已登录用户进入同一订阅方法，未绑定用户身份。
- 建议：在服务端将订阅与用户/有权限的空间关联，只向有权接收者发送事件。成员变化也应更新授权判断。此处是事件授权问题，不要求实现用户明确排除的会话踢线机制。

### 6. [P3] 保存视图参数未校验结构，合法 JSON 也能令前端报错并污染筛选状态

- 位置：`src/main/java/com/hourglass/kanban/dto/SavedViewRequest.java:15`；`src/main/java/com/hourglass/kanban/service/SavedViewService.java:34`；`src/main/resources/static/js/app.js:2297`。
- 触发：通过视图接口保存 params 字符串 `null`，或 `{"cats":"Work"}`，再点击应用。
- 原因：服务端只检查字符串非空与长度，原样保存；前端只捕获 JSON.parse 的语法错误，没检查结果是否为非空对象或 owners/cats 等字段是否为数组。
- 影响：null 会直接抛 TypeError，无法应用；错误类型会写入全局 state，随后筛选清理调用 cats.filter 报错，可能让看板刷新与筛选异常。影响通常局限于该用户的视图，标准 UI 生成的参数通常正确，优先级低于其他问题。
- 验证：当前 applyView 的 Node 探针输出 `null_view_error=TypeError`、`cats_type_after_view=string`、`filter_after_view_error=TypeError`；服务端保存路径未进行结构解析的结论来自源码核对。
- 建议：服务端保存前校验对象结构；前端先校验所有字段再一次性应用，错误时提示并保持原 state，避免部分更新。数组元素类型与字段取值也应校验。

## 第四轮修复复核

源码核对确认：跨空间计时日志已去掉新任务标题；直接并发降权/删除的路径增加管理员锁；循环关联已加入导出并在导入末尾按任务 ID 映射恢复；列名及分类渲染统一转义；CSV 已保护常见公式前缀；无成功码的推送响应会拒绝；子任务修改/删除已检查父任务有效性。

其中管理员保护和推送判断还有第 1、3 项中的遗漏，不能表述为全面修复完成。其余变化的本轮结论以源码核对为主，没有重新执行完整数据库或浏览器验收。

## 验证记录与限制

- 当前项目 `mvn -o -DskipTests package` 成功，编译 100 个 Java 源文件；没有测试源文件，该命令跳过测试。
- 当前 app.js 通过 Node vm.Script 语法解析。
- Java 探针使用当前 target/classes 与项目依赖，验证管理员服务交错、密码编码器、推送判断、SSE 待发送事件。
- Node 探针提取当前前端函数，验证日历响应乱序及保存视图参数。
- 没有执行真实 MySQL 锁/事务集成、浏览器端到端、生产部署或第三方推送；管理员交错探针不是数据库锁测试，SSE 探针不是实际网络连接测试。
- 探针使用模拟账号、假空间标识和构造密码，不涉及真实业务数据。临时源码位于系统临时目录，项目只新增本报告。
