# Hourglass

**English** | [简体中文](README.md)

> A self-hosted R&D collaboration workbench for small teams: requirements, review, docs, tasks, releases, and retrospectives all run on a single set of data.

**In one sentence**: Hourglass packs the entire R&D collaboration pipeline into a system you can deploy yourself:

> Ideas in the demand pool → review & scheduling → docs for the plan → break down into work items → kanban / calendar / Gantt → plan a version → complete, preview & confirm publication → weekly retrospective & monthly delivery list

Progress, work hours, member workload, overdue risks, and delivery reports are all generated automatically from everyday actions — nobody has to enter data twice.

- Project overview: [`docs/项目介绍.md`](docs/项目介绍.md) (Chinese)
- User manual: [`docs/用户使用手册.md`](docs/用户使用手册.md) (Chinese)
- API contract: [`docs/接口契约.md`](docs/接口契约.md) (Chinese)

## Live Demo

Public docs no longer publish a demo URL or guest credentials. To try Hourglass: deploy it yourself (about 30 minutes, see [`deploy/README.md`](deploy/README.md)), initialize the database from the single baseline script, then sign in and create your first project. Contact the maintainers for access to a hosted demo.

---

## Why This Project Exists

Hourglass came out of a direct observation of how small teams struggle. The common problem is not "nobody is doing the work" — it's that **nobody can see the whole picture**:

1. **Broken requirement chains** — ideas live in chat logs, plans in documents, tasks on a kanban board, and delivery happens by word of mouth. Ask at month's end "what did we promise in this release, and where does each item stand" and no one can answer in a single sentence.
2. **Managers can't see the whole picture** — which project is slipping, whose plate is full, who has spare capacity, which risk is brewing. The information lives in everyone's heads; you don't know unless you ask — and asking means asking around.
3. **Time is unaccountable** — records only say "done". Afterward nobody can answer "how long did this actually take, where did this month go".
4. **Retrospectives are stitched together** — weekly and monthly reports are assembled from chat logs, emails, and meeting notes. Painful to write, and readers don't quite trust them either.

Existing tools are either pure task boards (execution without requirements or metrics) or heavyweight R&D management platforms (expensive, demanding, needing a dedicated PMO). Hourglass fills the gap in between: **the work item is the backbone of execution, so requirements, docs, tasks, releases, and time all share one set of data — and every statistic can be traced back to a specific task, time window, and action.**

## Positioning

| Dimension | Description |
| --- | --- |
| Who it's for | Recommended for R&D teams of 50 or fewer people: they run requirement management and iterations, but have no dedicated PMO |
| Form factor | Single instance, self-hosted: one jar + MySQL; no Redis / MQ / object storage required |
| Core thesis | Task management is not the goal — **hours and retrospectives** are; moving a task drives the timer, and timers accumulate into weekly retrospectives and monthly delivery lists |
| Product style | Small and sharp: restrained scope, consistent metrics, every number explainable — no feature stacking to match big products |
| Explicit non-goals | Multi-tenant SaaS, large-scale horizontal scaling, real-time collaborative spreadsheet editing, highly configurable workflows, plugin marketplace |

## Key Features

### My

- **My Work**: all work items assigned to you, aggregated across workspaces with batched loading; a team view on mobile, where completion rate and hours can be scoped to this week, this month, or the last 30 days
- **Weekly Retrospective**: automatically summarizes the week's completed, pending-confirmation, and in-progress work; optional AI-drafted weekly report

### Planning

- **Demand Pool**: scheduling may leave the target version unspecified; any selected target must be nonreleased and in the same project. Planned dates are independent of the expected date. Replanning (including clearing the target), cancellation and restoration require a reason and revision, and never rewrite existing tasks
- **Projects / Global Health**: project list and global-health views; maintain owner, objective and planned dates, review workload and delivery resources; deletion has impact preview and release-evidence protection
- **Releases**: tasks may belong to multiple planned versions. Version content, independent release plans and each actual scope are distinct; multiple environments / targets, retries, repeated successes, redeploy and rollback are supported. Immutable snapshots remain separate from current hours; multiple links / events never multiply global work time.

> A–E is implemented and the local correctness gate passed: Java, real API / MySQL, full-demo readbacks, and real headless Chrome against backend 8120 / frontend 8121 at 1440/390px. Independent browser groups passed: navigation 72, permissions 29, recovery 27 (3 scenarios), planTime 6, screenshots 16 assertions. Seven delivery PNG pairs were regenerated, SHA256-matched and visually reviewed; deployment safety passed 212 isolated checks (including 73 script-syntax checks). Mobile evidence is emulation, not physical-phone testing. One owned browser-fixture workspace remains locally as formal evidence; the final rerun created no new workspaces. Production deployment / full seed remain blocked and unexecuted because production configuration writes were denied and explicit DB_NAME is missing; commit/push status is determined by Git (separate counts in the [changelog](CHANGELOG.md)). Only Task uses `versionIds/versionNames` arrays: omitted / null preserves links and `[]` unlinks; Demand and TestPlan retain a single target `versionId`. The read-only publication badge is derived from successful production records (`publishSource=record`), with no manual marking or unmarking; test/staging and failed events do not prove production publication. Rollback appends an event, revokes the referenced scope by target, and retains ever-published history and later independent successes. Successful facts freeze content associations, not task completion, reopening or timers. Release management requires a workspace owner/admin or writable project owner; task ownership and plan-owner metadata grant no version-wide release authority. See the [user manual](docs/用户使用手册.md) and [API contract](docs/接口契约.md). Only the seven delivery PNG pairs are newly captured acceptance images; older overview screenshots remain historical layout references.

### Delivery

- **Work Items**: kanban, list, calendar, and Gantt share one filter set; drag between columns and create inline. Gantt adds dependencies (FS / SS / FF / SF), milestones, baseline variance, critical path, and member workload, with CSV export, A3 printing, and read-only share links
- **Documents**: rich-text / Markdown docs in a tree, with full-text search, historical snapshots, shareable publishing, and AI task-draft generation
- **Tests**: cases, test plans, a coverage matrix, and test reports; a failed case converts directly into a bug work item, completed plans are locked as snapshots, and CSV import / export is supported
- **Branches**: workspace-level branch tracking through development, testing, merge, and release

### Insight

- **Reports**: trends & distribution, completion records, process health checks (first-pass rate, requirement start delay, estimation accuracy), and delivery charts (burndown, cumulative flow, velocity, lead-time distribution)
- **Member Workload / Overdue & Blocked**: see busyness across projects and handle at-risk items centrally; workload supports person / week drill-down and a monthly hours CSV export

### Platform Capabilities

- **Time tracking**: dragging into "In Progress" starts the timer; dragging into "Done" stops it and chains to the next task; manual backfill with void-and-recompute
- **Permissions**: workspace roles (owner / admin / member / viewer) plus per-project visibility control
- **Notifications**: in-app + SSE real-time push + email + external bots (Webhook / ServerChan / PushPlus)
- **Attachments**: images, PDF, Markdown, Word, ZIP, Excel; images, PDF, Markdown and Word open in a preview modal (images support zoom, rotation and panning), and `.xlsx` files can be edited right inside the work-item detail
- **AI assistant**: each user configures their own model and quota for requirement breakdown, doc health checks, and weekly report drafts; results land only after human confirmation
- **Data security**: rich-text whitelist sanitization, encrypted secrets, AI endpoints denied intranet access by default; per-workspace JSON moves working data (task version arrays, version.startDate, demand dates and canceled status), not official release evidence. Existing evidence prevents destructive overwrite; official evidence requires full database backup / restore
- **Transition constraints**: a source × target matrix per workspace (allow / require reason / deny), permissive by default; column-level processing rules control timing and overdue independently
- **Search and audit**: global search across demands, work items, documents, and test cases; audit logs with filters and CSV export, plus system information for admins
- **Mobile**: three responsive breakpoints; installable PWA

## Getting Started

Prerequisites: **JDK 8**, **Maven**, **MySQL 8**.

```bash
# 1. Fresh install: create the database, user, and schema in one step
mysql -uroot -p --default-character-set=utf8mb4 < sql/baseline/01_schema_full.sql

#    The account password in the baseline is a placeholder — change it before going live:
#    ALTER USER 'hourglass'@'%' IDENTIFIED BY 'your-strong-password';

# 2. Required configuration (all overridable via environment variables)
export DB_USER=hourglass
export DB_PASSWORD='your-db-password'
export AUTH_USER=admin
export AUTH_PASSWORD='your-login-password'

# 3. Build and start the backend (the jar contains only the API, not the frontend)
mvn -f backend/pom.xml -DskipTests package
java -jar backend/target/hourglass-server.jar

# 4. Serve the frontend with Nginx: point root at this repo's frontend/,
#    and reverse-proxy /hourglass/api/ to 8080
#    See deploy/nginx-hourglass.conf (locally you can set root to /absolute/path/to/frontend,
#    listen on 8081, then open http://127.0.0.1:8081/hourglass/)
```

For production, run `bash deploy/deploy.sh`: it detects changes → packages frontend / backend as needed → backs up the database → applies incremental SQL → swaps artifacts → health-checks, with `--dry-run` / `--rollback` support. See [`deploy/README.md`](deploy/README.md) (Chinese).

This A–E rollout is **for an independent empty database only**. Use `sql/baseline/01_schema_full.sql` for all 52 tables; do not replay 61/62 or migrate old history, and retain the original database and data. The full baseline rebuilds tables: it is not an idempotent, nondestructive script and must not be rerun on an existing database. The unreleased `63_delivery_release.sql` only adds columns and creates five tables: `version_release_plan`, `version_release_plan_task`, `version_release`, `version_release_item`, and `version_log`. It does not backfill, clear data or invent historical evidence, and is not an old-database migration entry point for this rollout. Upgrades of previously released schemas require review of the relevant numbered scripts; the destructive warnings for 61/62 still apply. See [`sql/README.md`](sql/README.md).

## Tech Stack

| Layer | Choice |
| --- | --- |
| Backend | Spring Boot 2.7.18 / Java 8 / MyBatis / Spring Security (session login + CSRF) |
| Database | MySQL 8 (utf8mb4), 52 tables including the unreleased delivery closure; full baseline for empty databases only, numbered increments require impact review |
| Realtime | SSE push for changes and notifications |
| Frontend | Vanilla JavaScript ES Modules, **no framework, no build step**; PWA offline shell |
| Deployment | Frontend served directly by Nginx, backend exposes only `/api/**`; systemd + one-command deploy script |

A few deliberate architectural choices:

- **No Redis**: metadata lives in an in-process cache invalidated by TTL and workspace version numbers — hence the single-instance positioning
- **Frontend/backend split, same origin**: the frontend is build-free and independently deployable; same-origin keeps session cookies, CSRF, and SSE behaving unchanged
- **Metrics read fact tables directly**: hours, burndown, and workload read `time_log` / `task_log` directly; backfilled or voided entries recompute automatically, with no second set of aggregate data

For the deeper information model, unified metric rules, the role-permission matrix, and the full configuration reference, see [`docs/项目介绍.md`](docs/项目介绍.md) and [`docs/用户使用手册.md`](docs/用户使用手册.md) (Chinese).

## Documentation

| File | Contents |
| --- | --- |
| [`docs/产品说明.md`](docs/产品说明.md) | Product overview: what it is, who it is for, core value and deployment shape (Chinese) |
| [`docs/快速上手指南.md`](docs/快速上手指南.md) | Quick start: a new team runs the main flow in 30 minutes (Chinese) |
| [`docs/项目介绍.md`](docs/项目介绍.md) | Background, positioning, information model, module map, core mechanisms (Chinese) |
| [`docs/用户使用手册.md`](docs/用户使用手册.md) | End-user manual and unified metric rules (Chinese) |
| [`docs/管理员指南.md`](docs/管理员指南.md) | Admin guide: deployment, backup and upgrade, notifications and AI, troubleshooting (Chinese) |
| [`docs/常见问题.md`](docs/常见问题.md) | FAQ: metric conventions, statistics, deployment and trade-offs (Chinese) |
| [`docs/接口契约.md`](docs/接口契约.md) | API contract with appendices on hours, calendar, retrospective conventions (Chinese) |
| [`deploy/README.md`](deploy/README.md) | Deployment guide: server prep, systemd, Nginx, backup and rollback (Chinese) |
| [`CHANGELOG.md`](CHANGELOG.md) | Changelog: milestones and notable changes |

## Scope & Trade-offs

| Not doing / limited | Why |
| --- | --- |
| Multi-tenant SaaS, large-scale horizontal scaling | Recommended for self-hosted teams of 50 or fewer people; single instance is a deliberate choice |
| Real-time collaborative spreadsheet editing | The online spreadsheet is for viewing attachments and quick edits; last-write-wins on save |
| Predictive statistics and AI scoring | Metrics are retrospective and traceable only; no unexplainable model outputs |
| Migration from other platforms | No Jira / ZenTao importers; internal backups restore per workspace |

## Collaboration

This project evolved from a personal kanban project started by [chc2](https://gitee.com/chc2) (chenghongchang) into **Hourglass**, a self-hosted R&D collaboration workbench for small teams. It is now maintained by chc2 and continuously improved.

Key contributors:

- [chc2](https://gitee.com/chc2) (chenghongchang) — project creator; designed and implemented the original personal kanban project; continues to develop and expand Hourglass
- kongxiangjin

## License

[PolyForm Noncommercial License 1.0.0](LICENSE): **source-available, no commercial use**. This is not OSI-approved open source.

- **Permitted**: use, modification and distribution for noncommercial purposes — personal study, research, experimentation, hobby projects; and use by charitable organizations, educational institutions, public research organizations, public safety or health organizations, environmental protection organizations and government institutions, regardless of funding.
- **Not permitted**: any commercial use — running the software in business operations, offering the software or services based on it for a fee, or using it in client delivery projects.
- **Commercial licensing**: enterprise intranet deployments, client delivery and paid pilots require a separate commercial license from the copyright holders (contact details to be added).
- Copyright, project history and contributor terms: see [NOTICE](NOTICE). Trademarks (the "Hourglass" name and logo) are not licensed.
- Licenses and copyrights of the bundled third-party frontend libraries (Univer, SheetJS, SunEditor, marked, DOMPurify, React, RxJS) and backend dependencies are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- Note: **MySQL Connector/J is GPL-2.0 with the Oracle FOSS Exception**, which most likely does not cover an application under a non-open-source license. Resolve it as described in that file before redistributing any build artifact.
