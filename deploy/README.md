# 部署指南（腾讯云轻量服务器 · Ubuntu）

前置说明：服务器已有 **JDK8、MySQL8、Nginx**，本项目**不使用 Redis**。以下命令在服务器上执行（root 或 sudo），我未接触你的服务器。

## 0. 本地打包（开发机）

Windows 上双击 `deploy\build.bat`（或命令行执行 `deploy\build.bat`），自动完成
`mvn -DskipTests clean package` → 收集 Jar/前端/配置 → 打出一个交付包：

```
deploy/dist/Hourglass-<版本>/
  hourglass-server.jar             后端可执行包（前端静态资源已打入 jar）
  frontend/                        前端静态资源，独立留存
  config/application.yml           外置配置，与 jar 同级的 config 目录会自动加载
  config/hourglass.env.example     环境变量模板 → 复制为 /etc/hourglass.env
  deploy/                          hourglass.service、nginx 配置、backup.sh、本指南
  sql/                             建库脚本、种子数据、上线清单
deploy/dist/Hourglass-<版本>.zip    同一交付包的压缩版
```

> 外置 `config/application.yml` 优先于 jar 内同名配置，改端口、连接池、附件目录不必重新打包。

Linux/Mac 开发机也可直接：

```bash
mvn -e -DskipTests package
# 产出 target/hourglass-server.jar
```

## 1. 服务器准备

```bash
# 目录与运行用户
sudo mkdir -p /opt/hourglass/backup
sudo useradd -r -s /usr/sbin/nologin hourglass || true
sudo chown -R hourglass:hourglass /opt/hourglass

# 确认 java 路径（若不是 /usr/bin/java，改 hourglass.service 里的 ExecStart）
which java

# 确认时区：日期判定/周回顾/每日推送时间都依赖它；不是北京时间就设置
date
sudo timedatectl set-timezone Asia/Shanghai

# 建库 + 建应用账号 + 建表（全新部署只需这一个文件，需 root 执行，可重复执行）
# 内含：CREATE DATABASE hourglass、账号 'hourglass'@'%'（库内全部权限）、全部表结构
mysql -uroot -p --default-character-set=utf8mb4 < sql/baseline/01_schema_full.sql
```

> 账号密码写在脚本里（占位值 `ChangeMe_Hourglass_2026!`），上线前改成强密码，并同步 `/etc/hourglass.env` 的 `DB_PASSWORD`；账号已存在时脚本不会覆盖密码，改密码用 `ALTER USER 'hourglass'@'%' IDENTIFIED BY '新密码';`。
> 账号 host 为 `%`，外部可直连；但还需 MySQL 的 `bind-address` 不是 `127.0.0.1`，并在防火墙放行 3306。
> 已部署过的库升级仍执行 `sql/` 下对应的增量脚本（如 `31_branch_project.sql`），不要重跑完整基线（会重建表）。

## 2. 上传 jar

把 `target/hourglass-server.jar` 传到 `/opt/hourglass/hourglass-server.jar`（MobaXterm 拖拽或 scp），然后 `sudo chown hourglass:hourglass /opt/hourglass/hourglass-server.jar`。

## 3. 环境变量文件（密码不写进代码库）

```bash
sudo bash -c 'cat > /etc/hourglass.env' <<'EOF'
DB_PASSWORD=更换为上面数据库账号的密码
AUTH_USER=admin
AUTH_PASSWORD=更换为管理员登录密码（也可填 bcrypt 哈希，$2a$/$2b$ 开头的完整 60 位）
EOF
sudo chmod 600 /etc/hourglass.env
```

> 说明：`AUTH_USER/AUTH_PASSWORD` 仅用于**首次启动引导创建管理员**（库中已有用户后不再读取）；后续账号由管理员在「用户」管理中创建下发，不开放注册。每个账号自动有个人空间；可另建共享空间邀请成员协作（空间主按登录名添加）。
> **值的写法（systemd 解析，和 shell 不同）**：每行的说明必须单独一行用 `#` 开头，**不要写在值后面**（行尾的 `#` 及其后内容会整个算进变量值里）；含 `$`、空格等特殊字符的值建议用单引号包裹（如 `AUTH_PASSWORD='$2y$10$...'`），引号会被剥掉、值保持不变。应用侧仅接受完整 60 位 bcrypt 格式，格式不符时按普通明文处理。

可选项（有默认值）：`DB_HOST`（默认 127.0.0.1）、`DB_NAME`（默认 hourglass）、`DB_USER`（默认 hourglass）、`SERVER_PORT`（默认 8080）、`BIND_ADDR`（默认 127.0.0.1）、`ATTACH_DIR`（附件目录，默认 `/opt/hourglass/data/attachments`，需确保 hourglass 用户可写）。

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

> **单实例约束**：成员关系（默认 60 秒 TTL）与空间 meta（列/分类/标签，版本号 + 300 秒兜底）都是**进程内缓存**，不跨实例共享。本部署方式是单实例 systemd 服务，可直接使用；如需多实例/多副本部署，必须去掉这两层缓存或改用共享缓存（如 Redis），否则成员权限变更与 meta 变更在其它实例上最多延迟一个 TTL 才生效。

## 5. Nginx 反代

```bash
sudo cp deploy/nginx-hourglass.conf /etc/nginx/conf.d/hourglass.conf
# 编辑 server_name 为你的域名或服务器IP
sudo nginx -t && sudo systemctl reload nginx
```

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

> 说明：`backup.sh` 只按行读取 `/etc/hourglass.env` 里的 `DB_NAME`/`ATTACH_DIR` 两个键（不是 `source` 整份文件，值里的 `$`、空格等不会被 Bash 求值）；`DB_NAME` 与应用保持一致。附件目录不存在或打包失败时会输出 WARN 并以非零码退出（cron 日志可见），不会静默假成功。mysqldump 已加 `--no-tablespaces`，库级授权账号（无全局 PROCESS 权限）也能正常导出；上线后建议实际执行一次备份并用 `mysql -uroot -p hourglass < 备份文件` 恢复到空库验证。

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

1. 若本次升级涉及数据库结构变化（看发布说明），先在服务器执行对应升级脚本（见 `sql/` 目录，均为幂等、可重复执行）。
2. 替换 `/opt/hourglass/hourglass-server.jar` → `sudo systemctl restart hourglass`。

> 例：升级到分支支持项目归属的版本，在已存在的库上执行一次：
> `mysql -uroot -p --default-character-set=utf8mb4 hourglass < 31_branch_project.sql`（全新安装无需执行，`01_schema_full.sql` 已含该结构）。

## 11. 验收清单

- [ ] `curl http://127.0.0.1:8080/hourglass/api/health` 返回 `"db":"up"`
- [ ] 浏览器访问域名/IP 跳登录页；登录后手机保持 30 天免登录
- [ ] 新增任务 → 拖拽移动 → 编辑查看「操作时间线」→ 筛选/搜索/回顾/导出全部可用
- [ ] 任务弹窗可增删勾选子任务，卡片上出现 2/5 角标，时间线记录子任务变更（含操作人）
- [ ] 管理员：侧栏「用户管理」（独立页面，仅管理员可见）新增用户/重置密码/删除用户可用；普通成员看不到该入口、直接访问接口返回 403
- [ ] 管理员「用户」建号 → 新账号登录看到全新个人空间；互相看不到数据
- [ ] 侧栏空间切换器：新建共享空间 → 空间设置中添加成员（登录名）
- [ ] 共享空间 → 空间设置 →「邀请链接」生成并复制；已有账号的同事登录后打开链接一键加入；未登录打开会引导先登录再回来加入；新同事须先在「用户管理」建号
- [ ] 侧栏底部点自己的名字：可修改显示名（负责人默认值随之更新）与密码
- [ ] 邀请链接撤销/过期后打开提示失效；被移除成员重新打开邀请链接可再次加入
- [ ] 被添加的账号刷新后能看到共享空间；两人同时打开：一方改动 1 秒内另一方自动刷新
- [ ] 共享空间里成员可正常增改删任务；成员看不到「删除空间/删列/删分类」入口，直接调接口返回 403
- [ ] 分类可增删改色（如把「前端」改成自己的业务分类），任务表单与筛选同步变化
- [ ] 「负责人」可下拉选择空间成员；时间线显示「谁改的」
- [ ] 个人空间与共享空间的视图/列/分类互不影响；切换空间后数据完全切换
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
