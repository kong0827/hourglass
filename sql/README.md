# SQL 目录说明

数据库脚本只有三个文件，按序号执行，不再维护增量升级链：

| 文件 | 内容 | 何时执行 |
| --- | --- | --- |
| [`01_schema.sql`](01_schema.sql) | 全量 DDL：54 张表、索引与全文索引，不含业务数据；同时建库与 `hourglass` 应用账号 | 全新部署，必执行 |
| [`02_init_data.sql`](02_init_data.sql) | 基础数据：`admin / admin123` 管理员、共享空间「演示空间」、4 列看板（待处理/进行中/待测试/测试中，含处理规则）、内置优先级、邮件开关 | 可选；省略则由后端启动引导（随机 admin 密码 + 后端默认看板） |
| [`03_seed_data.sql`](03_seed_data.sql) | 种子数据：8 名模拟用户 + 3 项目 + 模块/版本/需求/文档/任务/分支/用例/发布等全量覆盖模拟数据（含邀请预分配与计划跨版本关联示例），用于本地与演示验证 | 可选；依赖 02 创建的空间 |

## 1. 全新安装

```bash
mysql -uroot -p --default-character-set=utf8mb4 < sql/01_schema.sql
mysql -uroot -p --default-character-set=utf8mb4 hourglass < sql/02_init_data.sql   # 可选
mysql -uroot -p --default-character-set=utf8mb4 hourglass < sql/03_seed_data.sql   # 可选，演示环境
```

01 含 `CREATE DATABASE` / `CREATE USER` / `GRANT`，建议用 root 执行；02、03 指定库名。执行 01 后应用账号 `hourglass` 的一次性随机密码会以「沙漏部署提示」打印一次，请立即写入 `/etc/hourglass.env` 的 `DB_PASSWORD`。

**三份脚本都只用于新空库**：01 会 DROP 全部表重建，03 会先 DELETE 再 INSERT 指定前缀的数据；绝不能在已有真实数据的库上重跑。已有库的结构升级不再提供增量脚本——历史增量（01–66 编号）已从仓库移除，需要时可在 git 历史追溯；升级方式以新空库重建 + 数据迁移/恢复备份为准，须单独评估与授权。

## 2. 与后端引导的关系

02 的 `admin` 与后端 `UserService.bootstrapAdmin` 互补：库里已有用户时后端不再创建 admin，因此导入 02 后首次登录用 `admin / admin123`（首次登录后立即改密）。02 预置的看板列与后端 `WorkspaceService.seedColumns` 一致：待处理 / 进行中 / 待测试（waiting，排队不计时、仍计逾期）/ 测试中；已完成是后端虚拟系统列，不在 `board_column` 落行。`column_transition` 默认不插行，已完成重开与测试中退回在代码里默认「需原因」；03 尾部把已完成两条显式落库为 `done → backlog/doing = reason`，体现「已完成重开需填原因」。

## 3. 结构变更怎么改

直接修改 `sql/01_schema.sql`（新增表/列/索引），并同步 `sql/03_seed_data.sql` 若涉及种子数据；没有单独的增量文件。已有生产库的对应变更须手工编写并评估，不在本目录自动化范围内。
