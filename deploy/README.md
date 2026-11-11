# 部署指南（腾讯云轻量服务器 · Ubuntu）

前置说明：服务器已有 **JDK8、MySQL8、Nginx**，本项目**不使用 Redis**。本轮 A–E 已部署，线上 payload 逐条见 [`CHANGELOG.md`](../CHANGELOG.md) 的发布记录；原库单独授权重建、完整生产模拟与只读验收完成；生产 Chrome 1440/390px、24 次入口导航、93 项有效断言通过，0 runtime/console/HTTP 错误，每日 cron 未确认安装。以下是具备权限后的操作说明（root 或 sudo），不是授权执行任何命令或绕过权限；实际发布及回退边界见第 2 节。

## 0. 本地打包（开发机）

Windows 上双击 `deploy\build.bat`（或命令行执行 `deploy\build.bat`），自动完成
`mvn -DskipTests clean package` → 收集 Jar/前端/配置 → 打出一个交付包：

```
deploy/dist/Hourglass-<版本>/
  hourglass-server.jar             后端可执行包（纯 API，不含前端）
  frontend/hourglass/              前端静态资源（Nginx root 指向 frontend 目录）
  config/application.yml           外置配置，与 jar 同级的 config 目录会自动加载
  config/hourglass.env.example     环境变量模板 → 复制为 /etc/hourglass.env
  deploy/                          hourglass.service、nginx 配置、backup.sh、本指南
  sql/                             建库脚本、种子数据、上线清单（上线清单属内部资料、不在仓库内；build.bat 会按脚本注释的路径取用，缺失时只告警不中断打包）
deploy/dist/Hourglass-<版本>.zip    同一交付包的压缩版
```

> 前后端已分离：`hourglass-server.jar` 只提供 `/api/**`，页面、CSS、JS 由 Nginx 直接从 `frontend/hourglass/` 读取。
> 外置 `config/application.yml` 优先于 jar 内同名配置，改端口、连接池、附件目录不必重新打包。

Linux/Mac 开发机也可直接：

```bash
JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk1.8.0_291.jdk/Contents/Home \
  mvn -e -DskipTests -f backend/pom.xml package
# 产出 backend/target/hourglass-server.jar
```

> 必须用 JDK 8 打包。Maven 默认可能指向新版 JDK，此时旧版 Lombok 会静默失效，
> 编译报大量 `找不到符号`（实体类的 getter/setter 全部缺失），很容易误判成代码错误。
> Windows 上用 `deploy\build.bat` 会自行选择 JDK 8。

本地联调与回归：

```bash
bash deploy/local/stack.sh            # 起 MySQL(3307) + 后端(8080) + 静态服务(8081)
E2E_BASE=http://127.0.0.1:8081/hourglass E2E_USER=admin E2E_PASS=admin123 \
  node tools/e2e/smoke.mjs            # 浏览器冒烟：登录、12 个入口、驾驶舱、通知中心、导航使用记录
node tools/preview/gen-preview.js     # 重新生成 docs/preview/ui-preview.html
```

## 1. 服务器准备

```bash
# 目录与运行用户（frontend 是前端静态资源根，Nginx root 指向它）
sudo mkdir -p /opt/hourglass/backup /opt/hourglass/frontend
sudo useradd -r -s /usr/sbin/nologin hourglass || true
sudo chown -R hourglass:hourglass /opt/hourglass

# 确认 java 路径（若不是 /usr/bin/java，改 hourglass.service 里的 ExecStart）
which java

# 确认时区：日期判定/周回顾/每日推送时间都依赖它；不是北京时间就设置
date
sudo timedatectl set-timezone Asia/Shanghai

# 建库 + 建应用账号 + 建表（仅用于全新空库，需 root 执行；重跑会删表）
# 内含：CREATE DATABASE hourglass、随机口令创建账号 'hourglass'@'%'（库内全部权限）、全部表结构
mysql -uroot -p --default-character-set=utf8mb4 < sql/baseline/01_schema_full.sql
```

> 应用账号不再内置固定口令：脚本首次执行时用 `RANDOM_BYTES` 随机生成一次性密码，并在结束时以「沙漏部署提示」输出一次。**请立即把该密码写进第 3 步 `/etc/hourglass.env` 的 `DB_PASSWORD`（用单引号包裹）**；这条提示不会再次出现，也不要把建库输出重定向或记录到日志文件里。
> 账号已存在时脚本不改动其密码，只输出提示；重置密码用 `ALTER USER 'hourglass'@'%' IDENTIFIED BY '新密码';`。若你的 MySQL 禁用了 `RANDOM_BYTES`，按脚本内注释改用 `SHA2(CONCAT(UUID(), NOW(6), RAND()), 256)`，或先手工建号再执行脚本。
> 账号 host 为 `%`，外部可直连；但还需 MySQL 的 `bind-address` 不是 `127.0.0.1`，并在防火墙放行 3306。
> 既有已发布结构的升级按发布说明评估对应增量脚本；完整基线会重建表，不是幂等无损脚本，不得作为普通升级在已有库重跑。正常部署脚本仍只支持新空库；本轮 A–E 经用户单独明确授权，原 `hourglass` 46 表受限备份并恢复验证后重建为 52 表（当时口径；其后 `sql/65` 新增跨版本计划关联表、`sql/66` 新增成员项目授权模式与邀请项目预分配表，完整基线现为 54 表），不回放 61/62、不迁移旧历史。原历史仅在备份中保留，不能泛化为默认部署删库许可。
>
> **已有库升级到「新成员默认不参与项目」版本：先执行 `sql/66_project_access_assigned.sql`，再替换 jar。** 新 jar 会读写 `workspace_member.project_access_mode` 与 `invite_project_grant`，先换 jar 会导致成员列表、邀请与加入接口报错。66 只增列、建表并为 `assigned` 成员补 `none` 种子行，不改写已有授权；存量成员默认 `all`，升级后可见范围不变。执行前照常做全库备份。

## 2. 上传后端与前端

自动部署（推荐）：本地执行 `bash deploy/deploy.sh`，脚本会按改动范围只发布 jar 或只发布前端，并完成校验与备份。部署脚本保留已有备份，不自动清理。

**正常脚本仍只支持新空库；本轮原库重建是用户单独明确授权操作，不是脚本默认许可。**新库路径使用不存在的 `hourglass_` 前缀数据库，先备份当前数据库、配置和附件，再创建新库、执行 54 表基线并设置显式 DB_NAME；不回放 61/62、不迁移旧历史。本次最新授权替代新库-only 方案：原 `hourglass` 46 表先受限备份并恢复验证，再 DROP / CREATE 为 52 表；最终认证 JDBC 与 `DB_NAME=hourglass`，`hourglass_20261110` 保留额外回退点。原历史仅在备份中，不再原表在线保留。正式证据包括 plan / plan_task / record / item / log 五表，须随 MySQL 全库备份恢复。

A–E 首次交付时点的本地正确性门禁（历史记录，不代表当前 HEAD）：Java 821 tests（0 failures/errors/skipped，当时 `124ce05` 的 514 个发布候选源文件 parity，不是当前 HEAD）、真实 MySQL 14 mandatory 484 passed / 0 failed / 0 unverified、本地 full demo 990 回读分别通过；真实 headless Chrome backend 8120 / frontend 8121 在 1440/390px 的导航 72、权限 29、恢复 27（3 场景）、planTime 6、截图 16 断言独立通过。七对 delivery PNG 重拍、SHA256 配对一致并视觉查看，非物理手机测试；JS syntax 107 files / 3 unit suites、3 SVG、文档 14 checks / baseline convergence 16、部署安全隔离 212（含脚本语法 73）分别通过。1 个自建浏览器 fixture 空间留作本地证据，最终复跑未建新空间，不称全部本地数据已清理；独立统计见 [`CHANGELOG.md`](../CHANGELOG.md)。

**A–E 首次交付时点的实际部署（历史记录，当前线上 payload 见更新日志最新一条发布记录）：**生产 Chrome 1440/390px、24 次入口导航、93 项有效断言通过，0 runtime/console/HTTP 错误。`124ce05` 已正常 commit / push，生产 jar SHA256=`bd930b8caf43914d4af929ced29a9cb526170f35542f378c3b7ba638c2b46df5`；169 个生产前端文件 HTTP 200，字节 / SHA 与 `124ce05` archive 匹配，SW v120。首次 deploy.sh 因 umask 077 前端目录 700 / 文件 600 导致 403 / 500 中止；实际权限修为目录 755 / 文件 644，AppleDouble 元数据移入受限备份，独立完整回读通过，不能称首次 deploy.sh exit 0。后续 `2d7fe2e` 仅旧无引用 DTO 与部署 COPYFILE_DISABLE=1 / 递归权限修正，已在 origin/main；本段是 `124ce05` 时点的发布回读记录，其后每次部署登记在更新日志的发布记录里；`124ce05` 的 821 Java 全量测试与 514 source parity 只覆盖该时点，不代表后续 payload。

完整生产模拟已完成；只读验收 1747 GET / 3 login、7463 有效断言零失败 / 零 API 错误，无生产变更测试。8255 原执行含 792 被替换的 harness 日期断言（初 264 失败因 UTC manifest 11-09 误作本地业务日 11-10），纠正后零失败，不可加总。完整规模、66 产物 SHA / 44 plan raw UTF-8 SHA、三次稳定事件 canonical SHA 及工时 38940 / 版本卡 39930（含 990 跨版本重叠）见更新日志。

```bash
# 仅预演日常部署，明确当前数据库；不是原库重建命令或执行授权：
DEPLOY_HOST=43.156.155.204 NGINX_PORT=80 APP_PORT=8080 DEPLOY_DB_NAME=hourglass \
  bash deploy/deploy.sh --dry-run
# 新库路径仅适用于另一个确实不存在的 hourglass_ 前缀库；
# hourglass_20261110 已存在并保留作额外回退点，不可再次作为新库目标。
```

首次启动仍使用既有 `AUTH_USER/AUTH_PASSWORD` 引导管理员；既有 AUTH / DB 密码与 AI key 未改，env / backup.cnf 600。部署与软件回滚共用运行锁，checkpoint 必须配对同批 jar / env / 前端与 SHA；`--rollback` 不恢复 SQL 内容。**原库重建后的软件-only 回退不足：需匹配 SQL 恢复且另行明确授权**，不可自动覆盖现库。保护备份目录 `/opt/hourglass/backup/original-rebuild-20261109T224234-d2f13f0fc2d36d2b` 含 `original-hourglass.sql.gz`（原 46 表历史）与 `production-complete.sql.gz`（完整 52 表模拟）。完整生产 SQL 已恢复到主代理独占空库：INSERT 快照逐字节一致，536 列 / 328 索引 / 52 表 / 119 键元数据与捕获 DDL 自增快照一致；原始 DDL dump 文本因 MySQL 字符集规范化不逐字节相同。manifest 与凭据仅服务器 600，不上传 Git；未知运行锁不自动清理。

完整模拟数据由 `tools/seed_delivery_demo.py` 经 API 写入独立命名空间；只新增，不清空现有记录。必须设置 `ALLOW_DEMO_INSERT=new-namespaced-data`，并指定仓库外的 `SEED_MANIFEST`（权限 600，保存新账号凭据和对象 ID）；`SEED_BASE`、`SEED_USER`、`SEED_PASSWORD` 通过环境传入。先在隔离验收库执行 `--small`，正式插入通过服务器本机回环地址执行，避免经明文公网传输凭据。

手动部署：

```bash
# 后端
scp backend/target/hourglass-server.jar ubuntu@服务器:/tmp/
sudo mv /tmp/hourglass-server.jar /opt/hourglass/hourglass-server.jar
sudo chown hourglass:hourglass /opt/hourglass/hourglass-server.jar

# 前端：把 frontend 目录内容解压到 /opt/hourglass/frontend，最终结构为
#   /opt/hourglass/frontend/hourglass/index.html
scp hourglass-frontend.tar.gz ubuntu@服务器:/tmp/
sudo tar -xzf /tmp/hourglass-frontend.tar.gz -C /opt/hourglass/frontend
sudo chown -R hourglass:hourglass /opt/hourglass/frontend
```

## 3. 环境变量文件（密码不写进代码库）

```bash
# 仅全新安装；已有文件须先备份并保留现有密码与密钥，不能直接覆盖。
sudo bash -c 'cat > /etc/hourglass.env' <<'EOF'
DB_NAME=hourglass
DB_PASSWORD=更换为上面数据库账号的密码
AUTH_USER=admin
AUTH_PASSWORD=更换为管理员登录密码（也可填 bcrypt 哈希，$2a$/$2b$ 开头的完整 60 位）
EOF
sudo chmod 600 /etc/hourglass.env
```

> 说明：`AUTH_USER/AUTH_PASSWORD` 仅用于**首次启动引导创建管理员**（库中已有用户后不再读取）；后续账号由平台管理员在「设置 → 平台 → 账号管理」创建下发，不开放注册。每个账号自动有个人空间；可另建共享空间，成员通过邀请链接加入（按登录名直接加人仅平台管理员可用，普通空间主请使用邀请链接）。
> **值的写法（systemd 解析，和 shell 不同）**：每行的说明必须单独一行用 `#` 开头，**不要写在值后面**（行尾的 `#` 及其后内容会整个算进变量值里）；含 `$`、空格等特殊字符的值建议用单引号包裹（如 `AUTH_PASSWORD='$2y$10$...'`），引号会被剥掉、值保持不变。应用侧仅接受完整 60 位 bcrypt 格式，格式不符时按普通明文处理。

自动部署要求 `/etc/hourglass.env` 显式设置经核实的 `DB_NAME`，不能依赖应用的默认库名。其余可选项（有默认值）：`DB_HOST`（默认 127.0.0.1）、`DB_USER`（默认 hourglass）、`SERVER_PORT`（默认 8080）、`BIND_ADDR`（默认 127.0.0.1）、`ATTACH_DIR`（附件目录，默认 `/opt/hourglass/data/attachments`，需确保 hourglass 用户可写）。

**提醒推送渠道**（可选）：`NOTIFY_TYPE=webhook|serverchan|pushplus`（默认 webhook），`NOTIFY_TOKEN`（pushplus 的 token）。推送 webhook 已改为**按空间配置**（页面「空间设置」里填写，由空间主维护），环境变量里不再需要 `NOTIFY_WEBHOOK`；渠道说明见第 9 节。

## 4. 起服务（systemd）

```bash
sudo cp deploy/hourglass.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hourglass
systemctl status hourglass --no-pager        # 应 active (running)
journalctl -u hourglass -n 50 --no-pager     # 启动日志
curl -s http://127.0.0.1:8080/hourglass/api/health     # 期望 "db":"up"
```

> **单实例约束**：成员关系（默认 60 秒 TTL）与空间 meta（列/模块/标签，版本号 + 300 秒兜底）都是**进程内缓存**，不跨实例共享。本部署方式是单实例 systemd 服务，可直接使用；如需多实例/多副本部署，必须去掉这两层缓存或改用共享缓存（如 Redis），否则成员权限变更与 meta 变更在其它实例上最多延迟一个 TTL 才生效。

> **应用日志**：文件日志默认写到系统服务工作目录下的 `logs/hourglass.log`，生产即 `/opt/hourglass/logs/hourglass.log`；按 50MB 轮转、保留 30 份、总量上限 2GB。`deploy.sh` 会创建 `/opt/hourglass/logs`（hourglass 可写）并在重启后校验日志已生成。需要换位置时在 `/etc/hourglass.env` 设置 `LOG_FILE`（相对路径按工作目录解析）。journald 仍保留标准输出，两处内容一致。

## 5. Nginx（前端静态 + API 反代）

```bash
sudo cp deploy/nginx-hourglass.conf /etc/nginx/conf.d/hourglass.conf
# 编辑 server_name 为你的域名或服务器IP
sudo nginx -t && sudo systemctl reload nginx
```

配置要点：`root /opt/hourglass/frontend` 直接提供页面与静态资源；只有 `/hourglass/api/` 反代到 `127.0.0.1:8080`。二者同源，Cookie、CSRF 与 SSE 行为不变。

浏览器访问 `http://服务器IP/hourglass/` → 应跳转登录页，用第 3 步设置的账号登录。

## 6. 暴露面检查（重要）

```bash
# 8080 与 3306 必须只监听 127.0.0.1
ss -tlnp | grep -E ':(8080|3306)'
# 云控制台防火墙：只放行 22 / 80 / 443，关闭 8080、3306 的公网规则
```

## 7. HTTPS（有域名后）

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

HTTPS 同时是 PWA 的前提：配好后手机浏览器打开，菜单里选「添加到主屏幕」即可像 App 一样使用。

## 8. 每日自动备份

**以下是配置建议，不是已安装证明；生产每日 cron 尚未确认。**本轮原 46 表历史及完整 52 表生产模拟已完成受限备份／空库恢复验证，详见第 2 节；不要为安装定时任务覆盖现有受限配置或密码。

```bash
sudo cp deploy/backup.sh /opt/hourglass/backup.sh && sudo chmod +x /opt/hourglass/backup.sh
sudo bash -c 'cat > /etc/hourglass-backup.cnf' <<'EOF'
[client]
user=hourglass
password=更换为数据库密码
EOF
sudo chmod 600 /etc/hourglass-backup.cnf

# 手动跑一次验证
sudo /opt/hourglass/backup.sh && ls -lh /opt/hourglass/backup

# 加入 crontab（每天 03:00）
( sudo crontab -l 2>/dev/null; echo "0 3 * * * /opt/hourglass/backup.sh >> /var/log/hourglass-backup.log 2>&1" ) | sudo crontab -
```

> 说明：`backup.sh` 只按行读取 `/etc/hourglass.env` 里的 `DB_NAME`/`ATTACH_DIR` 两个键（不是 `source` 整份文件，值里的 `$`、空格等不会被 Bash 求值）；`DB_NAME` 与应用保持一致。附件目录不存在或打包失败时会输出 WARN 并以非零码退出（cron 日志可见），不会静默假成功。mysqldump 已加 `--no-tablespaces`，库级授权账号（无全局 PROCESS 权限）也能正常导出；本轮已完成完整生产 SQL 恢复验证；后续演练仍应仅恢复到另行创建的独占空库，不能向当前 `hourglass` 或额外回退库直接恢复。生产内容恢复另须明确授权并匹配 SQL 与软件备份。

## 9. 提醒推送（可选）

推送按**空间**配置：登录后打开「空间设置」填写该空间的 webhook（个人空间=你自己的推送地址；共享空间=群机器人，建议由空间主统一配置）。环境变量只保留渠道与开关（**值后面不要写说明**，说明单独成行）：

```bash
NOTIFY_ENABLED=true
# NOTIFY_TYPE 取值：webhook | serverchan | pushplus
NOTIFY_TYPE=webhook
# PushPlus 才需要填 NOTIFY_TOKEN=你的token（webhook/serverchan 不需要，可留空）
NOTIFY_TOKEN=
NOTIFY_CRON=0 0 9 * * *
# 上一行是 Spring cron（秒 分 时 日 月 周），每天 09:00 检查
NOTIFY_LINK=
# 可选：NOTIFY_LINK=https://你的域名/（消息末尾附看板地址）
```

> 安全说明：**pushplus 渠道下，`NOTIFY_TOKEN` 只会发送到官方固定端点（https://www.pushplus.plus/send）**；空间设置里填的地址此时只作为"启用推送"的开关，不会向其发送。其余渠道的空间地址保存与发送时都会校验（仅 http/https，拒绝本机/内网地址），且服务端不跟随重定向。

```bash
sudo systemctl restart hourglass
```

验证：登录后在空间设置里确认 webhook 已填，然后 Apifox 登录态下 POST `http://127.0.0.1:8080/hourglass/api/notify/test`，应立刻收到消息，返回 `"sent": true`。

两种推送：每天 09:00 的汇总（只有存在**逾期或当天到期**任务时才推送）；任务里单独设置的**提醒时间**（每 5 分钟扫描一次）。共享空间的消息标题带空间名，内容含负责人。

## 10. 升级流程

1. 既有已发布结构的升级按发布说明评估所需编号脚本；幂等不等于无损，先备份并确认影响。本轮 A–E 不迁移旧历史，原库重建是第 2 节所述单独授权操作；正常脚本仍只支持新空库，不回放 61/62，完整基线不得作为普通升级在已有库重跑。
2. 替换产物：
   - 只改前端：覆盖 `/opt/hourglass/frontend/hourglass/`，无需重启后端；
   - 只改后端：替换 `/opt/hourglass/hourglass-server.jar` 后 `sudo systemctl restart hourglass`；
   - 前后端都改：两步都做。
3. 日常升级直接执行 `bash deploy/deploy.sh`，脚本会自动判断范围、备份旧产物并校验哈希。

> 例：升级到分支支持项目归属的版本，在已存在的库上执行一次：
> `mysql -uroot -p --default-character-set=utf8mb4 hourglass < 31_branch_project.sql`（全新安装无需执行，`01_schema_full.sql` 已含该结构）。

## 11. 验收清单

- [ ] `curl http://127.0.0.1:8080/hourglass/api/health` 返回 `"db":"up"`
- [ ] 浏览器访问域名/IP 跳登录页；登录后手机保持 30 天免登录
- [ ] 新增任务 → 拖拽移动 → 编辑查看「操作时间线」→ 筛选/搜索/回顾/导出全部可用
- [ ] 任务弹窗可增删勾选子任务，卡片上出现 2/5 角标，时间线记录子任务变更（含操作人）
- [ ] 平台管理员：`设置 → 平台 → 账号管理` 新增用户 / 重置密码 / 删除用户可用；普通成员看不到「平台」页签、直接访问接口返回 403
- [ ] 平台管理员建号 → 新账号登录看到全新个人空间；互相看不到数据
- [ ] 侧栏空间切换器：新建共享空间 →「设置 → 成员与权限」生成邀请链接
- [ ] 共享空间 →「设置 → 成员与权限」→「邀请链接」生成并复制；已有账号的同事登录后打开链接一键加入；未登录打开会引导先登录再回来加入；新同事须先由平台管理员在账号管理中建号
- [ ] 侧栏底部点自己的名字：可修改显示名（负责人默认值随之更新）与密码
- [ ] 邀请链接撤销/过期后打开提示失效；被移除成员重新打开邀请链接可再次加入
- [ ] 被添加的账号刷新后能看到共享空间；两人同时打开：一方改动 1 秒内另一方自动刷新
- [ ] 共享空间里成员可正常增改删任务；成员看不到「删除空间/删列/删模块」入口，直接调接口返回 403
- [ ] 模块可增删改色（如把「前端」改成自己的业务模块），任务表单与筛选同步变化
- [ ] 「负责人」可下拉选择空间成员；时间线显示「谁改的」
- [ ] 个人空间与共享空间的视图/列/模块互不影响；切换空间后数据完全切换
- [ ] 空间设置中填 webhook → /api/notify/test 收到消息；共享空间消息标题带空间名
- [ ] 快速录入：「明天提交周报 !P0」回车直接创建并解析出日期/优先级
- [ ] 今日聚焦一键过滤；标签输入联想、筛选生效；「存为视图」后刷新仍在
- [ ] 循环任务完成后自动生成下一次；任务级提醒（设时间后到点收到推送）
- [ ] 工时计时开始/停止，卡片出现工时角标，报表显示本周/累计工时
- [ ] 附件上传（图片可直接预览）、下载、删除
- [ ] 列设置中新增一列（如「待验收」）、改色、排序、删除（任务自动转移）
- [ ] 删除任务进回收站，可恢复/彻底删除；列表视图排序切换正常
- [ ] 两台设备同时打开：一台改动后另一台约 1 秒自动刷新（SSE）
- [ ] 「日历」按月浏览、点日期看当天任务、点任务直接编辑
- [ ] 「报表」显示近 8 周新增/完成趋势与分布
- [ ] （可选）提醒推送测试成功；每天 09:00 自动检查
- [ ] 手机「添加到主屏幕」后全屏打开（需 HTTPS）
- [ ] 用旧版页面「导出任务备份」的 JSON 走「导入任务备份」成功，条数一致（v4 含评论与回收站；需求文档/分支不在任务备份内）
- [ ] `ls /opt/hourglass/backup` 有当天备份文件
- [ ] `ss -tlnp` 确认 8080/3306 未对公网开放
