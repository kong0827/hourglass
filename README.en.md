# Hourglass Workbench

A personal Kanban board that answers three questions on one screen:
**what am I doing now, how long did it take, and what did I actually ship this week?**

Spring Boot + MyBatis + MySQL on the back end. The front end is plain JavaScript —
no framework, no build step, just a single-page app with a PWA offline shell.

> **Live preview** → [`docs/ui-preview.html`](docs/ui-preview.html)
> A single self-contained file with the real CSS/JS and demo data. Opens without a server.

---

## Why

Spreadsheets are fine for listing tasks, but they fail at three things:

1. **Where a task stands** — a column can't express "in progress" vs "waiting";
2. **How long it took** — "done" tells you nothing about where the month went;
3. **What shipped this week** — reassembling that from chat history is the worst part of a weekly report.

So the point here isn't task management. It's **time tracking** and **retrospectives**:
moving a task drives the timer, and the timer feeds the weekly review and the monthly list.

---

## Features

| Module | What it does |
| --- | --- |
| **Board** | Drag between columns, reorder, inline add; filters by owner / priority / category / project / tag / due / blocked |
| **Time tracking** | Start and stop straight from the card. Moving a task into "In progress" starts the timer; moving it to "Done" stops it and **hands off** to the next task in that column |
| **List** | The board's filter set, rendered as rows |
| **Calendar** | Tasks span every day from their start date to their *actual* end date; early finishes stop occupying later days |
| **Weekly review** | Auto-summary plus three mutually exclusive groups: completed / pending sign-off / in progress. Historical weeks only count what was actually touched that week |
| **Completion list** | Completing a task writes a **snapshot** (project name, owner, dates, total time), browsable by month and exportable to CSV |
| **My tasks** | Everything assigned to me, across workspaces |
| **Notifications** | Task reminders, daily digest, overdue badges, pushed over SSE |
| **Projects / Trash / Settings** | Project rollups, 30-day trash, members and invite links, column and category management, data import/export |

---

## Stack

| Layer | Choice |
| --- | --- |
| Back end | Spring Boot 2.7.18, Java 8, MyBatis 2.3.2, Spring Security (session auth) |
| Database | MySQL 8 (utf8mb4). No Redis — caching and locking stay in-process |
| Front end | Plain JavaScript, no framework, no bundler; inline SVG icons; Service Worker offline shell |
| Deployment | systemd + Nginx reverse proxy; one-command `deploy/deploy.sh` |

---

## Getting started

Requires **JDK 8**, **Maven**, **MySQL 8**.

```bash
# 1. Create the schema (scripts are numbered and idempotent)
for f in sql/0*.sql; do mysql -u root -p < "$f"; done

# 2. Create the app account (all privileges on the schema; root also works for local dev)
#    For a fresh server deployment use sql/baseline/01_schema_full.sql instead:
#    it creates the database, the account and all tables in one file.
mysql -u root -p -e "CREATE USER IF NOT EXISTS 'hourglass'@'%' IDENTIFIED BY 'your-db-password'; GRANT ALL PRIVILEGES ON hourglass.* TO 'hourglass'@'%'; FLUSH PRIVILEGES;"

# 3. Configure (every value can be overridden by an environment variable)
export DB_USER=hourglass
export DB_PASSWORD='your-db-password'
export AUTH_USER=admin
export AUTH_PASSWORD='your-login-password'

# 4. Build and run
mvn -DskipTests package
java -jar target/hourglass-server.jar
```

Open <http://127.0.0.1:8080> and sign in with `AUTH_USER` / `AUTH_PASSWORD`.
The admin account and your personal workspace are created on first start.

---

## Configuration

Everything is injected through environment variables; the config file only holds placeholders
(**no credentials are committed**).

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVER_PORT` | `8080` | HTTP port |
| `BIND_ADDR` | `127.0.0.1` | Loopback by default; expose through Nginx |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | MySQL address |
| `DB_NAME` | `hourglass` | Schema name |
| `DB_USER` / `DB_PASSWORD` | `hourglass` / empty | Database credentials |
| `AUTH_USER` / `AUTH_PASSWORD` | `admin` / empty | Admin account created on first start (left empty → not created) |
| `ATTACH_DIR` | `./data/attachments` | Attachment storage |
| `NOTIFY_TYPE` / `NOTIFY_ENABLED` | `webhook` / `false` | External notification channel |

---

## Design decisions worth knowing

These came out of real bugs; they are documented so they don't get "fixed" back:

- **Effective work time skips weekends and caps at 8 hours per person per day.**
  Several tasks on the same day share that one 8-hour budget (not 8 hours each), across workspaces.
  The rule lives in `common/WorkTime` and is used by stopping, live display and auto-stop alike.
- **Time belongs to the person, not the task.** One running timer per user; starting B stops A,
  and the UI says exactly which task it paused.
- **Hand-off on completion.** Completing the running task hands the timer to the first remaining task
  in the same column — but only when the user has no other running timer, so it never steals a timer
  from another workspace.
- **The calendar uses the *actual* end date** (`min(completed date, due date)`).
  Finishing early should stop the task from occupying later days.
- **Weekly review groups are mutually exclusive**, and historical weeks are reconstructed from
  `task_log` activity — there is no per-week state snapshot.
- **The completion list is a snapshot, not a live query.** Renaming a project or deleting a task
  later does not rewrite history.

---

## Documentation

| File | Contents |
| --- | --- |
| [`docs/api.md`](docs/api.md) | API contract plus every rule revision (work time, calendar, review, archiving) |
| [`docs/ui-redesign-spec.md`](docs/ui-redesign-spec.md) | UI spec: layout, components, interaction states |
| [`docs/ui-preview.html`](docs/ui-preview.html) | Offline preview (single file, just open it) |
| [`deploy/README.md`](deploy/README.md) | Deployment guide: server setup, systemd, Nginx, backup and rollback |

---

## Deployment

```bash
./deploy/deploy.sh
```

Detects changes, builds, backs up the database and applies SQL, uploads and swaps the jar,
runs a health check, then records the new deployment baseline.
See [`deploy/README.md`](deploy/README.md) for the full walkthrough.

---

## License

See [LICENSE](LICENSE).
