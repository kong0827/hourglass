# 演示种子数据（历史样例）

本目录存放早期演示环境的种子脚本，**不是全新安装步骤**。它们生成于“模块改为项目级”之前，使用空间级 `category(workspace_id, ...)` 与 `task.category` 文本列；当前基线已改为项目级 `category.requirement_id` 与 `task.category_id`，直接导入会报未知列。

| 文件 | 来源 | 状态 |
| --- | --- | --- |
| `seed_demo.sql` | 手工维护的小型演示数据 | 旧结构，需按 `sql/61_category_id.sql`、`sql/62_category_project.sql` 调整 |
| `seed_demo_public.sql` | 公开演示环境导出 | 旧结构，需调整 |
| `seed_demo_extra.sql` | 演示数据补充 | 旧结构，需调整 |
| `seed_mock.sql` | 压测/填充用随机数据 | 旧结构，需调整 |
| `seed_yunying.sql` | 由 `tools/data/gen_seed_yunying.py` 生成 | 旧结构，需调整生成器后重新生成 |
| `seed_kanban_ops.sql` | 由 `tools/gen_kanban_seed.py` 生成 | 旧结构，需调整生成器后重新生成 |

需要演示环境时，当前做法是：

1. 用 `sql/baseline/01_schema_full.sql` 建空库；
2. 启动后端，用引导出的 `admin` 账号登录；
3. 在界面创建项目、模块、需求与工作项。

种子脚本升级到 `category_id` / `requirement_id` 结构后，会在这里标注“可直接导入”及对应基线版本。
