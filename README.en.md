# Hourglass

**English** | [简体中文](README.md)

> A self-hosted R&D collaboration workbench for small teams: requirements, review, docs, tasks, releases, and retrospectives all run on a single set of data.

**In one sentence**: Hourglass packs the entire R&D collaboration pipeline into a system you can deploy yourself:

> Ideas in the demand pool → review & scheduling → docs for the plan → break down into work items → kanban / calendar / Gantt → bind to a release → weekly retrospective & monthly delivery list

Progress, work hours, member workload, overdue risks, and delivery reports are all generated automatically from everyday actions — nobody has to enter data twice.

- Project overview: [`docs/项目介绍.md`](docs/项目介绍.md) (Chinese)
- User manual: [`docs/用户使用手册.md`](docs/用户使用手册.md) (Chinese)
- API contract: [`docs/接口契约.md`](docs/接口契约.md) (Chinese)

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
| Who it's for | R&D teams of 10–50: they run requirement management and iterations, but have no dedicated PMO |
| Form factor | Single instance, self-hosted: one jar + MySQL; no Redis / MQ / object storage required |
| Core thesis | Task management is not the goal — **hours and retrospectives** are; moving a task drives the timer, and timers accumulate into weekly retrospectives and monthly delivery lists |
| Product style | Small and sharp: restrained scope, consistent metrics, every number explainable — no feature stacking to match big products |
| Explicit non-goals | Multi-tenant SaaS, large-scale horizontal scaling, real-time collaborative spreadsheet editing, highly configurable workflows, plugin marketplace |

## Key Features

### My Work

- **My Tasks**: all work items assigned to you, aggregated across workspaces with batched loading; a team view on mobile
- **Weekly Retrospective**: automatically summarizes the week's completed, pending-confirmation, and in-progress work; optional AI-drafted weekly report

### Project Collaboration

- **Projects / Project Overview**: health, overdue items, and this week's effort across all projects, with drill-down to specific work items
- **Demand Pool**: requirement intake, review, and scheduling; automatic WSJF scoring, fully auditable
- **Documents**: rich-text / Markdown docs in a tree, with full-text search, historical snapshots, shareable publishing, and AI task-draft generation
- **Test Cases**: case maintenance and execution records; a failed run converts directly into a bug work item

### Work Items

- **Kanban**: drag between columns, inline creation; filters shared across kanban, list, calendar, and Gantt
- **Task List / Calendar**: table view and a day-by-day calendar view
- **Gantt**: dependencies (FS / SS / FF / SF), milestones, baseline variance, critical path, member workload; CSV export, A3 printing, read-only share links
- **Branches**: workspace-level branch tracking through development, testing, merge, and release

### Insight & Metrics

- **Analytics**: trends, completion records, process health checks (first-pass rate, requirement start delay, estimation accuracy)
- **Report Center**: burndown, cumulative flow, velocity, and lead-time distribution charts, exportable
- **Release Stages**: first-release / iteration dual views, release notes generated automatically
- **Member Workload / Overdue & Blocked**: see busyness across projects and handle at-risk items centrally

### Platform Capabilities

- **Time tracking**: dragging into "In Progress" starts the timer; dragging into "Done" stops it and chains to the next task; manual backfill with void-and-recompute
- **Permissions**: workspace roles (owner / admin / member / viewer) plus per-project visibility control
- **Notifications**: in-app + SSE real-time push + email + external bots (Webhook / ServerChan / PushPlus)
- **Attachments**: images, PDF, Markdown, ZIP, Excel; `.xlsx` files can be edited right inside the task detail
- **AI assistant**: each user configures their own model and quota for requirement breakdown, doc health checks, and weekly report drafts; results land only after human confirmation
- **Data security**: rich-text whitelist sanitization, encrypted secret storage, AI endpoints denied intranet access by default; full per-workspace backup export / import
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

To upgrade an existing database, run the numbered scripts under `sql/` in order (all idempotent); for demo data, optionally run `sql/seeds/seed_demo.sql` (default account `admin / admin123`, local demo only).

## Tech Stack

| Layer | Choice |
| --- | --- |
| Backend | Spring Boot 2.7.18 / Java 8 / MyBatis / Spring Security (session login + CSRF) |
| Database | MySQL 8 (utf8mb4), 43 tables, numbered idempotent migration scripts |
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
| [`docs/项目介绍.md`](docs/项目介绍.md) | Background, positioning, information model, module map, core mechanisms (Chinese) |
| [`docs/用户使用手册.md`](docs/用户使用手册.md) | End-user manual and unified metric rules (Chinese) |
| [`docs/接口契约.md`](docs/接口契约.md) | API contract with appendices on hours, calendar, retrospective conventions (Chinese) |
| [`deploy/README.md`](deploy/README.md) | Deployment guide: server prep, systemd, Nginx, backup and rollback (Chinese) |
| [`CHANGELOG.md`](CHANGELOG.md) | Changelog: milestones and notable changes |

## Scope & Trade-offs

| Not doing / limited | Why |
| --- | --- |
| Multi-tenant SaaS, large-scale horizontal scaling | Self-hosted for teams under 50; single instance is a deliberate choice |
| Real-time collaborative spreadsheet editing | The online spreadsheet is for viewing attachments and quick edits; last-write-wins on save |
| Predictive statistics and AI scoring | Metrics are retrospective and traceable only; no unexplainable model outputs |
| Migration from other platforms | No Jira / ZenTao importers; internal backups restore per workspace |

## License

[Mulan Permissive Software License, Version 2 (MulanPSL-2.0)](LICENSE)

Licenses and copyrights of the bundled third-party frontend libraries (Univer, SheetJS, SunEditor, marked, DOMPurify) are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
