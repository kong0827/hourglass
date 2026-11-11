#!/usr/bin/env bash
# =============================================================================
# 沙漏 Hourglass · 一键部署脚本（前后端分离版）
#
# 用法（在项目根目录执行）：
#   bash deploy/deploy.sh              自动判断改动范围后部署（推荐日常使用）
#   bash deploy/deploy.sh --dry-run    只检测改了什么、要走哪些步骤，不实际执行
#   bash deploy/deploy.sh --force      即使没检测到改动也强制重新部署
#   bash deploy/deploy.sh --sql-all    已有 hourglass 库的增量重放（拒绝 61/62；需逐项评估）
#   bash deploy/deploy.sh --new-database=hourglass_YYYYMMDD 独立新库启用（保留原库，只接受不存在的新库）
#   bash deploy/deploy.sh --no-verify  已禁用：不允许跳过登录/哈希校验
#   bash deploy/deploy.sh --rollback   回滚最近完整 checkpoint 的同批 jar/env/前端
#
# 自动判断逻辑：
#   - 只改 frontend/         → 只打前端包、只换静态资源（不重新编译 Java）
#   - 只改 backend/（Java 等）→ 只打 jar、只换后端包（前端不动）
#   - 改了 sql/*.sql         → 先备份整库，再按文件名顺序执行改动的脚本
#   - 前后端都改             → 两个产物都发布
#   - 什么都没改             → 提示并退出（除非 --force）
#
# 服务器目录布局：
#   /opt/hourglass/hourglass-server.jar        后端
#   /opt/hourglass/frontend/hourglass/...      前端（Nginx root=/opt/hourglass/frontend）
#   /opt/hourglass/backup/checkpoint-<runId>/  配对 jar/env/frontend + ready
#   /opt/hourglass/.deploy-lock/              部署/回滚互斥锁
#   /opt/hourglass/.deploy-staging/<runId>/    本次受限临时目录
#
# 依赖：本地 mvn + java（仅改后端时需要）；能免密 SSH 到服务器；服务器上 sudo 免密
# =============================================================================
set -euo pipefail

# ------------------------------- 配置区 --------------------------------------
HOST="${DEPLOY_HOST:-124.223.208.134}"
SSH_USER="${DEPLOY_USER:-ubuntu}"
SSH_PORT="${DEPLOY_PORT:-22}"

APP_DIR="/opt/hourglass"                 # 服务器应用目录
FRONT_DIR="${APP_DIR}/frontend"          # 前端静态资源根（Nginx root）
SERVICE="hourglass"                      # systemd 服务名
JAR_NAME="hourglass-server.jar"
ENV_FILE="/etc/hourglass.env"            # 服务器环境变量文件（含 DB/AUTH 凭据）
BACKUP_DIR="${APP_DIR}/backup"

NGINX_PORT="${NGINX_PORT:-8081}"            # 对外 nginx 端口（目标机 nginx 监听 80 时：NGINX_PORT=80）
APP_PORT="${APP_PORT:-8082}"                # 应用内部端口（仅本机）
PUBLIC_URL="http://${HOST}:${NGINX_PORT}/hourglass"

MVN="${MVN:-mvn}"
NEW_DB=""
REQUESTED_DB="${DEPLOY_DB_NAME:-}"
CURRENT_DB=""
TARGET_DB=""

# 需要做字节级校验的前端文件（相对 frontend 目录）
VERIFY_FILES=(
  "index.html"
  "login.html"
  "join.html"
  "help.html"
  "manifest.webmanifest"
  "share.html"
  "favicon.ico"
  "config.js"
  "icons/favicon-32.png"
  "sw.js"
  "js/main.js"
  "js/share.js"
  "js/core/api.js"
  "js/core/activity-ui.js"
  "js/core/app.js"
  "js/core/dom.js"
  "js/core/filters-ui.js"
  "js/core/filters.js"
  "js/core/icons.js"
  "js/core/nav-telemetry.js"
  "js/core/notifications.js"
  "js/core/realtime.js"
  "js/core/router.js"
  "js/core/shell.js"
  "js/core/shortcuts.js"
  "js/core/state.js"
  "js/core/task-actions.js"
  "js/core/task-drawer.js"
  "js/core/templates/index.js"
  "js/core/templates/overlays.js"
  "js/core/templates/task-drawer.js"
  "js/core/theme.js"
  "js/core/ui.js"
  "js/core/utils.js"
  "js/core/view-loader.js"
  "js/lib/download.js"
  "js/lib/format.js"
  "js/lib/gantt-shared.js"
  "js/views/analysis.js"
  "js/views/board.js"
  "js/views/branches.js"
  "js/views/calendar.js"
  "js/views/demands.js"
  "js/views/gantt.js"
  "js/views/list.js"
  "js/views/manager-shared.js"
  "js/views/mine.js"
  "js/views/phase.js"
  "js/views/portfolio.js"
  "js/views/profile.js"
  "js/views/project.js"
  "js/views/projects.js"
  "js/views/report.js"
  "js/views/requirements.js"
  "js/views/review.js"
  "js/views/risks.js"
  "js/views/settings.js"
  "js/views/workload.js"
  "css/app.css"
  "css/tokens.css"
  "css/base.css"
  "css/auth.css"
  "css/views.css"
  "css/layout.css"
  "css/components.css"
  "css/gantt.css"
  "css/share.css"
)

# ----------------------------- 基础准备 --------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_DIR"

# 上次成功部署的"戳记文件"：用它的 mtime 作为比对基准。
STATE_STAMP="${SCRIPT_DIR}/.last-deploy.stamp"
# 安全说明：保留正常的主机密钥校验（不设 StrictHostKeyChecking=no / UserKnownHostsFile=/dev/null）。
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o LogLevel=ERROR)
SCP_OPTS=(-q -o BatchMode=yes -o ConnectTimeout=20 -o LogLevel=ERROR)

if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'
  C_TITLE=$'\033[36m'; C_DIM=$'\033[2m'; C_RST=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_TITLE=""; C_DIM=""; C_RST=""
fi
step()  { printf '\n%s==> %s%s\n' "$C_TITLE" "$*" "$C_RST"; }
info()  { printf '    %s\n' "$*"; }
ok()    { printf '    %s✓%s %s\n' "$C_OK" "$C_RST" "$*"; }
warn()  { printf '    %s!%s %s\n' "$C_WARN" "$C_RST" "$*"; }
err()   { printf '    %s✗%s %s\n' "$C_ERR" "$C_RST" "$*" >&2; }
die()   { err "$*"; exit 1; }

# Each remote script receives literal, shell-quoted configuration and common safety
# helpers. No environment file is ever sourced or evaluated as shell code.
sudo_do() {
  local mode="${1:-guard}" sql_base="${2:-}"
  {
    printf '%s=%q\n' RUN_ID "$RUN_ID" REMOTE_STAGE "$REMOTE_STAGE" \
      APP_DIR "$APP_DIR" FRONT_DIR "$FRONT_DIR" SERVICE "$SERVICE" \
      JAR_NAME "$JAR_NAME" ENV_FILE "$ENV_FILE" BACKUP_DIR "$BACKUP_DIR" \
      SSH_USER "$SSH_USER" REQUESTED_DB "$REQUESTED_DB" CURRENT_DB "$CURRENT_DB" \
      TARGET_DB "$TARGET_DB" NEW_DB "$NEW_DB" REMOTE_MODE "$mode" SQL_BASE "$sql_base" \
      NGINX_PORT "$NGINX_PORT"
    printf 'VERIFY_FILES=('
    printf ' %q' "${VERIFY_FILES[@]}"
    printf ' )\n'
    cat <<'REMOTE_COMMON'
set -euo pipefail
umask 077
LOCK_DIR="$APP_DIR/.deploy-lock"
read_env() {
  python3 - "$1" "${2:-$ENV_FILE}" <<'PY'
import pathlib, sys
values = {}
for line in pathlib.Path(sys.argv[2]).read_text().splitlines():
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    values[key.strip()] = value
print(values.get(sys.argv[1], ''))
PY
}
assert_owner() {
  [ -d "$LOCK_DIR" ] && [ ! -L "$LOCK_DIR" ] && [ -f "$LOCK_DIR/owner" ] && \
    [ ! -L "$LOCK_DIR/owner" ] && [ "$(< "$LOCK_DIR/owner")" = "$RUN_ID" ] || {
    echo "部署锁所有者不匹配；拒绝操作或清理未知锁" >&2; exit 1;
  }
}
assert_database() {
  local observed
  observed="$(read_env DB_NAME)"
  [[ "$observed" =~ ^[a-zA-Z0-9_]+$ && ${#observed} -le 64 ]] || {
    echo "当前配置缺少合法 DB_NAME；拒绝猜测默认数据库" >&2; exit 1;
  }
  [ -z "$REQUESTED_DB" ] || [ "$REQUESTED_DB" = "$observed" ] || {
    echo "DEPLOY_DB_NAME 与当前实际配置不一致；未修改数据库" >&2; exit 1;
  }
  [ -z "$CURRENT_DB" ] || [ "$CURRENT_DB" = "$observed" ] || {
    echo "锁定后 DB_NAME 已变化；拒绝继续" >&2; exit 1;
  }
  printf '%s\n' "$observed"
}
atomic_env_copy() {
  local source="$1" target="$2" temp
  temp="$(mktemp "${target}.tmp-${RUN_ID}.XXXXXX")"
  cp -- "$source" "$temp"
  chmod 600 "$temp"
  chown root:root "$temp"
  mv -T -- "$temp" "$target"
}
checkpoint_complete() {
  local checkpoint="$1"
  [ -d "$checkpoint" ] && [ ! -L "$checkpoint" ] && \
    [ -s "$checkpoint/jar" ] && [ ! -L "$checkpoint/jar" ] && \
    [ -s "$checkpoint/env" ] && [ ! -L "$checkpoint/env" ] && \
    [ ! -L "$checkpoint/frontend" ] && [ -f "$checkpoint/frontend/hourglass/index.html" ] && \
    [ -s "$checkpoint/SHA256SUMS" ] && \
    (cd "$checkpoint" && sha256sum --quiet -c SHA256SUMS)
}
make_checkpoint() {
  local checkpoint="$1" db
  [ -s "$APP_DIR/$JAR_NAME" ] && [ -s "$ENV_FILE" ] && \
    [ -f "$FRONT_DIR/hourglass/index.html" ] || {
    echo "缺少旧 jar/env/frontend 完整配对，拒绝无安全回退点的部署" >&2; exit 1;
  }
  mkdir -m 700 -- "$checkpoint"
  cp -aL -- "$APP_DIR/$JAR_NAME" "$checkpoint/jar"
  atomic_env_copy "$ENV_FILE" "$checkpoint/env"
  db="$(read_env DB_NAME "$checkpoint/env")"
  [[ "$db" =~ ^[a-zA-Z0-9_]+$ && ${#db} -le 64 ]] || {
    echo "checkpoint 配置缺少合法数据库名称" >&2; exit 1;
  }
  cp -aL -- "$FRONT_DIR" "$checkpoint/frontend"
  (cd "$checkpoint" && find jar env frontend -type f -print0 | sort -z | \
    xargs -0 sha256sum > SHA256SUMS)
  checkpoint_complete "$checkpoint" || { echo "checkpoint 校验失败" >&2; exit 1; }
  printf '%s\n' "$RUN_ID" > "$checkpoint/ready.tmp"
  mv -T -- "$checkpoint/ready.tmp" "$checkpoint/ready"
}
[ "$REMOTE_MODE" != guard ] || assert_owner
REMOTE_COMMON
    cat
  } | ssh -T "${SSH_OPTS[@]}" -p "$SSH_PORT" "${SSH_USER}@${HOST}" 'sudo bash -s'
}

start_session() {
  RUN_ID="$(python3 - <<'PY'
import datetime, secrets, time
print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' +
      str(time.time_ns()) + '-' + secrets.token_hex(16))
PY
)"
  REMOTE_STAGE="${APP_DIR}/.deploy-staging/${RUN_ID}"
  umask 077
  LOCAL_TMP="$(mktemp -d)"
  LOCK_ATTEMPTED=0
  trap cleanup_session EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  LOCK_ATTEMPTED=1
  sudo_do acquire <<'REMOTE'
mkdir -p -- "$APP_DIR"
if ! mkdir -m 700 -- "$LOCK_DIR"; then
  echo "已有部署/回滚锁，拒绝并发；不会清理未知锁" >&2
  exit 1
fi
printf '%s\n' "$RUN_ID" > "$LOCK_DIR/owner"
[ ! -L "$APP_DIR/.deploy-staging" ] || { echo "staging 父目录不能是符号链接" >&2; exit 1; }
mkdir -p -- "$APP_DIR/.deploy-staging" "$BACKUP_DIR"
install -d -m 750 -o hourglass -g hourglass "$APP_DIR/logs"
chmod 711 "$APP_DIR/.deploy-staging"
mkdir -m 700 -- "$REMOTE_STAGE"
chown "$SSH_USER:$SSH_USER" "$REMOTE_STAGE"
REMOTE
}

cleanup_session() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [ "${LOCK_ATTEMPTED:-0}" -eq 1 ]; then
    if ! sudo_do release <<'REMOTE'
# Only the acknowledged owner may remove its own staging and lock. A stale or
# foreign lock is deliberately left for an operator to inspect.
if [ -d "$LOCK_DIR" ] && [ ! -L "$LOCK_DIR" ] && [ -f "$LOCK_DIR/owner" ] && \
   [ ! -L "$LOCK_DIR/owner" ] && [ "$(< "$LOCK_DIR/owner")" = "$RUN_ID" ]; then
  rm -rf -- "$REMOTE_STAGE"
  rm -- "$LOCK_DIR/owner"
  rmdir -- "$LOCK_DIR"
fi
REMOTE
    then
      warn "清理连接失败；保留远端锁/本次临时目录供人工检查，不清理其他运行"
    fi
  fi
  [ -z "${LOCAL_TMP:-}" ] || rm -rf -- "$LOCAL_TMP"
  exit "$status"
}

vget() { printf '%s\n' "$VERIFY_OUT" | grep -m1 "^$1 " || true; }

# ----------------------------- 参数解析 --------------------------------------
DRY_RUN=0; FORCE=0; SQL_ALL=0; DO_VERIFY=1; ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --force)     FORCE=1 ;;
    --sql-all)   SQL_ALL=1 ;;
    --no-verify) DO_VERIFY=0 ;;
    --rollback)  ROLLBACK=1 ;;
    --new-database=*) NEW_DB="${arg#*=}" ;;
    -h|--help)   sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           die "未知参数：$arg（用 --help 查看用法）" ;;
  esac
done
if [ -n "$NEW_DB" ]; then
  [[ "$NEW_DB" =~ ^hourglass_[a-zA-Z0-9_]+$ && ${#NEW_DB} -le 64 ]] || die "新库名必须为 hourglass_ 前缀的安全标识，不能是原 hourglass 库"
  [ "$ROLLBACK" -eq 0 ] && [ "$SQL_ALL" -eq 0 ] || die "独立新库部署不能与回滚或重放增量脚本组合"
  [ "$DO_VERIFY" -eq 1 ] || die "独立新库启用必须通过正式校验，不能使用 --no-verify"
  TARGET_DB="$NEW_DB"
  FORCE=1
fi
if [ -n "$REQUESTED_DB" ]; then
  [[ "$REQUESTED_DB" =~ ^[a-zA-Z0-9_]+$ && ${#REQUESTED_DB} -le 64 ]] || die "数据库名称不合法"
fi

# ============================= 回滚流程 ======================================
if [ "$ROLLBACK" -eq 1 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dry-run：将恢复最近 jar、对应配置与前端备份；不修改任何服务或数据库"
    exit 0
  fi
  step "回滚最近完整 checkpoint（同批 jar / env / frontend；不写数据库）"
  start_session
  sudo_do <<'REMOTE'
assert_database >/dev/null
LATEST=""
while IFS= read -r candidate; do
  [ -f "$candidate/ready" ] && [ ! -L "$candidate/ready" ] || continue
  if checkpoint_complete "$candidate"; then
    LATEST="$candidate"
    break
  fi
  echo "跳过不完整或损坏 checkpoint：$candidate" >&2
done < <(find "$BACKUP_DIR" -maxdepth 1 -type d -name 'checkpoint-*' | sort -r)
[ -n "$LATEST" ] || {
  echo "无完整 ready checkpoint；旧独立 jar/frontend/.env 备份不能自动配对或跨库回退。请人工核对同批配置；不会修改数据库。" >&2
  exit 1
}
RESTORE_DB="$(read_env DB_NAME "$LATEST/env")"
[[ "$RESTORE_DB" =~ ^[a-zA-Z0-9_]+$ && ${#RESTORE_DB} -le 64 ]] || exit 1
# Preserve even a partially broken current release; it must not become a ready
# rollback candidate. Restoring a complete old checkpoint must not require a
# working index.html in the failed frontend.
FAILED="$BACKUP_DIR/failed-before-rollback-${RUN_ID}"
mkdir -m 700 -- "$FAILED"
atomic_env_copy "$ENV_FILE" "$FAILED/env"
[ ! -f "$APP_DIR/$JAR_NAME" ] || cp -a -- "$APP_DIR/$JAR_NAME" "$FAILED/jar"
[ ! -d "$FRONT_DIR" ] || cp -a -- "$FRONT_DIR" "$FAILED/frontend"
cp -a -- "$LATEST/jar" "$REMOTE_STAGE/restore.jar"
cp -a -- "$LATEST/frontend" "$REMOTE_STAGE/restore.frontend"
chown hourglass:hourglass "$REMOTE_STAGE/restore.jar"
chown -R hourglass:hourglass "$REMOTE_STAGE/restore.frontend"
atomic_env_copy "$LATEST/env" "$ENV_FILE"
mv -T -- "$REMOTE_STAGE/restore.jar" "$APP_DIR/$JAR_NAME"
if [ -e "$FRONT_DIR" ]; then
  mv -T -- "$FRONT_DIR" "$REMOTE_STAGE/front-before-restore"
fi
mv -T -- "$REMOTE_STAGE/restore.frontend" "$FRONT_DIR"
systemctl restart "$SERVICE"
sleep 8
[ "$(systemctl is-active "$SERVICE")" = active ] || exit 1
echo "已恢复同批 checkpoint：${LATEST}；配置目标 ${RESTORE_DB}；所有数据库内容保持不变"
REMOTE
  ok "回滚完成"
  exit 0
fi

# ============================= 1. 检测改动范围 ================================
step "1/6 检测改动范围"
if [ -f "$STATE_STAMP" ]; then
  LAST_TS="$(date -r "$STATE_STAMP" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo '未知')"
  info "上次部署时间：${LAST_TS}"
else
  info "无部署记录（首次运行）→ 视为全部改动"
fi

changed() {
  if [ -f "$STATE_STAMP" ]; then
    find "$@" -type f -not -path '*/target/*' -newer "$STATE_STAMP" 2>/dev/null
  else
    find "$@" -type f -not -path '*/target/*' 2>/dev/null
  fi
}

# 完整基线会删表、旧结构与种子会重灌过时数据，只允许手工执行，不纳入自动部署改动检测
CHANGED_ALL="$(changed backend sql frontend | grep -vE '^sql/(baseline|legacy|seeds)/' || true)"
if [ -n "$CHANGED_ALL" ]; then
  printf '%s\n' "$CHANGED_ALL" | sed 's/^/      /'
else
  info "（无改动）"
fi

CHANGED_SQL=""
for f in $(find sql -maxdepth 1 -name '*.sql' 2>/dev/null | sort); do
  if [ "$SQL_ALL" -eq 1 ] || [ ! -f "$STATE_STAMP" ]; then CHANGED_SQL="${CHANGED_SQL}${f} "; continue; fi
  if printf '%s\n' "$CHANGED_ALL" | grep -qxF "$f"; then
    CHANGED_SQL="${CHANGED_SQL}${f} "
  fi
done

HAS_BACKEND=0
if printf '%s\n' "$CHANGED_ALL" | grep -qE '(^|/)src/.*\.(java|xml|yml|yaml|properties)$|pom\.xml$'; then HAS_BACKEND=1; fi
HAS_FRONTEND=0
if printf '%s\n' "$CHANGED_ALL" | grep -qE '(^|/)frontend/'; then HAS_FRONTEND=1; fi

if [ -n "$NEW_DB" ]; then
  CHANGED_SQL=""
fi
NEED_DB=0; [ -n "${CHANGED_SQL// /}" ] && NEED_DB=1
[ -n "$NEW_DB" ] && NEED_DB=1
NEED_JAR=0
if [ "$HAS_BACKEND" -eq 1 ] || [ "$FORCE" -eq 1 ]; then NEED_JAR=1; fi
NEED_FRONT=0
if [ "$HAS_FRONTEND" -eq 1 ] || [ "$FORCE" -eq 1 ]; then NEED_FRONT=1; fi

echo
info "改动判定："
info "  后端 Java/资源 : $([ $HAS_BACKEND -eq 1 ] && echo '有（需重新打包 jar）' || echo '无')"
info "  前端静态资源   : $([ $HAS_FRONTEND -eq 1 ] && echo '有（需重新打包 frontend）' || echo '无')"
info "  数据库脚本     : $([ $NEED_DB -eq 1 ] && echo "有 → ${NEW_DB:-$CHANGED_SQL}（需先备份原库）" || echo '无（跳过数据库步骤）')"
[ -z "$NEW_DB" ] || info "  独立新库       : ${NEW_DB}（仅空库；原库和原数据不删除、不迁移）"
info "  部署动作       : jar=$([ $NEED_JAR -eq 1 ] && echo '发布' || echo '跳过')  frontend=$([ $NEED_FRONT -eq 1 ] && echo '发布' || echo '跳过')  db=$([ $NEED_DB -eq 1 ] && echo '执行' || echo '跳过')"

if [ "$DRY_RUN" -eq 1 ]; then
  step "dry-run：仅预览，未执行任何变更"
  exit 0
fi

if [ -z "$CHANGED_ALL" ] && [ "$FORCE" -eq 0 ]; then
  warn "未检测到任何改动。如需强制重新部署请加 --force"
  exit 0
fi

# Reject destructive historical scripts before any upload, backup or local write.
for f in $CHANGED_SQL; do
  [[ "$f" =~ ^sql/[a-zA-Z0-9_.-]+\.sql$ ]] || die "不安全的 SQL 文件名：$f"
  case "$f" in sql/61_*|sql/62_*) die "${f} 会清理旧模块数据，不能自动重放；请使用独立新库部署" ;; esac
done

start_session
# Read the real configured target under the same lock, before any SQL upload/write.
CURRENT_DB="$(sudo_do <<'REMOTE'
DB="$(assert_database)"
printf '%s\n' "$DB"
REMOTE
)"
[[ "$CURRENT_DB" =~ ^[a-zA-Z0-9_]+$ && ${#CURRENT_DB} -le 64 ]] || die "无法确定当前数据库"
TARGET_DB="${NEW_DB:-$CURRENT_DB}"
if [ -z "$NEW_DB" ] && [ "$NEED_DB" -eq 1 ] && [ "$CURRENT_DB" != hourglass ]; then
  die "编号增量内含 USE hourglass，当前实际库为 ${CURRENT_DB}；拒绝备份新库后修改原库"
fi
if [ -n "$NEW_DB" ]; then
  sudo_do <<'REMOTE'
assert_database >/dev/null
COUNT="$(mysql -N -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${NEW_DB}'")"
[ "$COUNT" = 0 ] || { echo "新库已存在，拒绝覆盖（即使空库）" >&2; exit 1; }
REMOTE
fi
# Establish the complete old pair before changing the DB target or either artifact,
# including frontend-only and SQL-only deployments. Partial checkpoints lack ready.
sudo_do <<'REMOTE'
assert_database >/dev/null
make_checkpoint "$BACKUP_DIR/checkpoint-${RUN_ID}"
echo "旧 jar/env/frontend 完整 checkpoint 已验证：checkpoint-${RUN_ID}"
REMOTE
PENDING_STAMP="${LOCAL_TMP}/pending-deploy.stamp"
touch "$PENDING_STAMP"

# ============================= 2. 本地构建 ====================================
step "2/6 本地构建"

BUILD_DIR="${LOCAL_TMP}/backend-build"
JAR_PATH="${BUILD_DIR}/target/${JAR_NAME}"
DIST_DIR="$LOCAL_TMP"
FRONT_STAGE="${DIST_DIR}/frontend-pkg"
FRONT_TAR="${DIST_DIR}/hourglass-frontend.tar.gz"

if [ "$NEED_JAR" -eq 1 ]; then
  # 打包前硬校验：MyBatis resultType 短别名必须在 entity 包内，否则启动直接失败
  ALIAS_BAD=""
  while read -r _alias; do
    [ -n "$_alias" ] || continue
    case "$_alias" in
      int|integer|long|short|byte|float|double|boolean|String|string|map|Map|list|List|object|date|Date|bigdecimal|BigDecimal|void) continue ;;
    esac
    [ -f "${PROJECT_DIR}/backend/src/main/java/com/hourglass/entity/${_alias}.java" ] || ALIAS_BAD="${ALIAS_BAD} ${_alias}"
  done < <(grep -rhoE 'resultType="[A-Za-z_][A-Za-z0-9_]*"' "${PROJECT_DIR}"/backend/src/main/resources/mapper/*.xml 2>/dev/null | sed 's/.*="//;s/"//' | sort -u || true)
  if [ -n "$ALIAS_BAD" ]; then
    die "mapper 里有无法解析的短别名：${ALIAS_BAD}
      这些类型不在 entity 包（mybatis.type-aliases-package）里，写全限定名即可，例如
      resultType=\"com.hourglass.dto.ReqDocView\"
      已中止部署（服务器未受任何影响）"
  fi

  command -v "$MVN" >/dev/null 2>&1 || die "找不到 mvn，请确认 Maven 已装且在 PATH 中"
  mkdir -m 700 -- "$BUILD_DIR"
  cp -- "${PROJECT_DIR}/backend/pom.xml" "$BUILD_DIR/pom.xml"
  cp -R -- "${PROJECT_DIR}/backend/src" "$BUILD_DIR/src"
  info "后端：私有源码快照构建，不改共享 backend/target"
  if ! BUILD_OUT="$("$MVN" -B -DskipTests -f "$BUILD_DIR/pom.xml" clean package 2>&1)"; then
    printf '%s\n' "$BUILD_OUT" | tail -30 >&2
    die "打包失败，已中止部署（服务器未受任何影响）"
  fi
  printf '%s\n' "$BUILD_OUT" | grep -E 'BUILD SUCCESS|Total time' | sed 's/^/      /' || true

  [ -f "$JAR_PATH" ] || die "未找到构建产物：$JAR_PATH"
  LOCAL_JAR_SIZE="$(wc -c < "$JAR_PATH" | tr -d ' ')"
  LOCAL_JAR_SHA="$(sha256sum "$JAR_PATH" | cut -c1-16)"
  ok "jar：$(ls -lh "$JAR_PATH" | awk '{print $5}')  sha256(前16)=${LOCAL_JAR_SHA}"
else
  info "后端：无改动，跳过 mvn"
fi

if [ "$NEED_FRONT" -eq 1 ]; then
  command -v tar >/dev/null 2>&1 || die "找不到 tar"
  [ -f "frontend/index.html" ] || die "frontend/index.html 不存在，前端目录不完整"
  rm -rf "$FRONT_STAGE"
  mkdir -p "${FRONT_STAGE}/hourglass"
  cp -R frontend/. "${FRONT_STAGE}/hourglass/"
  COPYFILE_DISABLE=1 tar -czf "$FRONT_TAR" -C "$FRONT_STAGE" hourglass
  LOCAL_FRONT_SIZE="$(wc -c < "$FRONT_TAR" | tr -d ' ')"
  LOCAL_FRONT_SHA="$(sha256sum "$FRONT_TAR" | cut -c1-16)"
  ok "frontend：$(ls -lh "$FRONT_TAR" | awk '{print $5}')  sha256(前16)=${LOCAL_FRONT_SHA}"
else
  info "前端：无改动，跳过打包"
fi

# ============================= 3. 数据库（按需） ==============================
if [ "$NEED_DB" -eq 1 ]; then
  step "3/6 数据库：备份整库 → 执行变更脚本"
  info "待执行：${NEW_DB:-$CHANGED_SQL}"
  if [ -n "$NEW_DB" ]; then
    BASELINE_STAGE="${DIST_DIR}/new-database.sql"
    python3 - "$NEW_DB" "sql/baseline/01_schema_full.sql" "$BASELINE_STAGE" <<'PY'
import pathlib, re, sys
name, source, target = sys.argv[1:]
sql = pathlib.Path(source).read_text()
start = re.search(r'^USE hourglass;\s*$', sql, re.M)
if start is None:
    raise SystemExit('基线缺少唯一 USE 入口')
body = sql[start.end():]
if re.search(r'\bUSE\b|\bCREATE\s+DATABASE\b|\bDROP\s+DATABASE\b|(?:\bhourglass\b|`hourglass`)\s*\.', body, re.I):
    raise SystemExit('拒绝包含额外数据库切换或原库限定引用的基线')
pathlib.Path(target).write_text('USE `' + name + '`;\n' + body)
PY
    scp "${SCP_OPTS[@]}" -P "$SSH_PORT" "$BASELINE_STAGE" "${SSH_USER}@${HOST}:${REMOTE_STAGE}/new-database.sql" >/dev/null || die "上传新库基线失败"
  fi

  for f in $CHANGED_SQL; do
    scp "${SCP_OPTS[@]}" -P "$SSH_PORT" "$f" "${SSH_USER}@${HOST}:${REMOTE_STAGE}/deploy-sql-$(basename "$f")" >/dev/null \
      || die "上传 SQL 失败：$f"
  done
  ok "SQL 脚本已上传到本次受限 staging"

  sudo_do <<'REMOTE'
DB_NAME="$(assert_database)"
DB_PW="$(read_env DB_PASSWORD)"
DB_USER="$(read_env DB_USER)"
DB_USER="${DB_USER:-hourglass}"
[ -n "$DB_PW" ] || { echo "无法读取 DB_PASSWORD" >&2; exit 1; }
BK="$BACKUP_DIR/hourglass-pre-deploy-${RUN_ID}.sql.gz"
ATTACH_BK="$BACKUP_DIR/hourglass-attachments-${RUN_ID}.tar.gz"
echo "  · 备份当前实际库 $DB_NAME → $BK"
EXPECTED_TABLES="$(MYSQL_PWD="$DB_PW" mysql -u "$DB_USER" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}' AND table_type='BASE TABLE'")"
[[ "$EXPECTED_TABLES" =~ ^[0-9]+$ ]] && [ "$EXPECTED_TABLES" -gt 0 ] || {
  echo "实际库没有可验证的表结构" >&2; exit 1;
}
# pipefail preserves mysqldump failure even when gzip itself succeeds.
MYSQL_PWD="$DB_PW" mysqldump -u "$DB_USER" --single-transaction --no-tablespaces --routines --triggers "$DB_NAME" | gzip > "$BK.tmp"
gzip -t "$BK.tmp"
TABLES="$(gzip -dc "$BK.tmp" | python3 -c 'import sys; print(sum(line.startswith("CREATE TABLE ") for line in sys.stdin))')"
[ "$TABLES" = "$EXPECTED_TABLES" ] || { echo "备份表数不匹配，拒绝 SQL 修改" >&2; exit 1; }
mv -T -- "$BK.tmp" "$BK"
atomic_env_copy "$ENV_FILE" "$BACKUP_DIR/hourglass-env-${RUN_ID}.bak"
ATTACH_DIR="$(read_env ATTACH_DIR)"
ATTACH_DIR="${ATTACH_DIR:-$APP_DIR/data/attachments}"
case "$ATTACH_DIR" in /*) ;; *) ATTACH_DIR="$APP_DIR/${ATTACH_DIR#./}" ;; esac
[ -d "$ATTACH_DIR" ] || { echo "附件目录不存在，不能建立完整备份" >&2; exit 1; }
tar -czf "$ATTACH_BK.tmp" -C "$ATTACH_DIR" .
gzip -t "$ATTACH_BK.tmp"
tar -tzf "$ATTACH_BK.tmp" >/dev/null
# Compare the archive with the source, not just its gzip header/listing.
tar -dzf "$ATTACH_BK.tmp" -C "$ATTACH_DIR"
mv -T -- "$ATTACH_BK.tmp" "$ATTACH_BK"
printf '%s\n' "$DB_NAME" > "$BACKUP_DIR/database-backup-${RUN_ID}.ready"
echo "    数据库与附件备份校验通过，表数：$TABLES"
REMOTE
  ok "原数据库、应用配置与附件备份完成（历史备份全部保留）"
  if [ -n "$NEW_DB" ]; then
    sudo_do <<'REMOTE'
assert_database >/dev/null
[ -f "$BACKUP_DIR/database-backup-${RUN_ID}.ready" ] || exit 1
COUNT="$(mysql -N -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${NEW_DB}'")"
[ "$COUNT" = 0 ] || { echo "新库已存在，拒绝覆盖" >&2; exit 1; }
mysql -e "CREATE DATABASE \`${NEW_DB}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON \`${NEW_DB}\`.* TO 'hourglass'@'%';"
COUNT="$(mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${NEW_DB}'")"
[ "$COUNT" = 0 ] || { echo "新库已非空，拒绝覆盖" >&2; exit 1; }
mysql --default-character-set=utf8mb4 "$NEW_DB" < "$REMOTE_STAGE/new-database.sql"
COUNT="$(mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${NEW_DB}'")"
[[ "$COUNT" =~ ^[0-9]+$ ]] && [ "$COUNT" -gt 0 ] || { echo "新库表结构验证失败" >&2; exit 1; }
REMOTE
    ok "新结构已写入独立新库 ${NEW_DB}，未更改原库"
  fi

  for f in $(printf '%s\n' $CHANGED_SQL | sort); do
    base="$(basename "$f")"
    info "执行 ${base}"
    sudo_do guard "$base" <<'REMOTE'
DB_NAME="$(assert_database)"
[ "$DB_NAME" = hourglass ] && [ "$TARGET_DB" = "$DB_NAME" ] || {
  echo "编号增量内含 USE hourglass，拒绝对实际目标之外的数据库执行" >&2; exit 1;
}
case "$SQL_BASE" in 61_*|62_*) echo "拒绝清理旧数据的增量" >&2; exit 1 ;; esac
[ -f "$BACKUP_DIR/database-backup-${RUN_ID}.ready" ] || exit 1
DB_PW="$(read_env DB_PASSWORD)"
DB_USER="$(read_env DB_USER)"
DB_USER="${DB_USER:-hourglass}"
[ -n "$DB_PW" ] || exit 1
MYSQL_PWD="$DB_PW" mysql --default-character-set=utf8mb4 -u "$DB_USER" "$DB_NAME" < "$REMOTE_STAGE/deploy-sql-${SQL_BASE}"
echo "    $(MYSQL_PWD="$DB_PW" mysql -u "$DB_USER" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'") 张表"
REMOTE
  done
  ok "数据库变更完成"
else
  step "3/6 数据库：本次无 SQL 改动，跳过（不碰库）"
fi

# ============================= 4. 上传并发布 ==================================
step "4/6 上传并发布"

if [ "$NEED_JAR" -eq 1 ]; then
  JAR_MB="$(awk -v s="$LOCAL_JAR_SIZE" 'BEGIN{printf "%.1f", s/1048576}')"
  info "上传 jar（${JAR_MB}MB）"
  scp "${SCP_OPTS[@]}" -P "$SSH_PORT" "$JAR_PATH" "${SSH_USER}@${HOST}:${REMOTE_STAGE}/${JAR_NAME}.new" >/dev/null \
    || die "上传 jar 失败"
  ok "jar 上传完成"
fi

if [ "$NEED_FRONT" -eq 1 ]; then
  info "上传前端包（$(ls -lh "$FRONT_TAR" | awk '{print $5}')）"
  scp "${SCP_OPTS[@]}" -P "$SSH_PORT" "$FRONT_TAR" "${SSH_USER}@${HOST}:${REMOTE_STAGE}/hourglass-frontend.tar.gz.new" >/dev/null \
    || die "上传前端包失败"
  ok "前端包上传完成"
fi

if [ "$NEED_FRONT" -eq 1 ]; then
  sudo_do <<'REMOTE'
assert_database >/dev/null
checkpoint_complete "$BACKUP_DIR/checkpoint-${RUN_ID}" || exit 1
[ -f "$BACKUP_DIR/checkpoint-${RUN_ID}/ready" ] || exit 1
mkdir -m 700 -- "$REMOTE_STAGE/frontend.new"
tar -xzf "$REMOTE_STAGE/hourglass-frontend.tar.gz.new" -C "$REMOTE_STAGE/frontend.new"
[ -f "$REMOTE_STAGE/frontend.new/hourglass/index.html" ] || { echo "前端包缺少 hourglass/index.html" >&2; exit 1; }
chown -R hourglass:hourglass "$REMOTE_STAGE/frontend.new"
find "$REMOTE_STAGE/frontend.new" -type d -exec chmod 755 {} +
find "$REMOTE_STAGE/frontend.new" -type f -exec chmod 644 {} +
# The durable old pair lives in the checkpoint; this displaced directory is ours.
mv -T -- "$FRONT_DIR" "$REMOTE_STAGE/frontend.displaced"
mv -T -- "$REMOTE_STAGE/frontend.new" "$FRONT_DIR"
echo "    · 前端文件数：$(find "$FRONT_DIR" -type f | wc -l)"
REMOTE
  ok "前端发布完成"
fi

if [ "$NEED_JAR" -eq 1 ]; then
  sudo_do <<'REMOTE'
assert_database >/dev/null
checkpoint_complete "$BACKUP_DIR/checkpoint-${RUN_ID}" || exit 1
[ -f "$BACKUP_DIR/checkpoint-${RUN_ID}/ready" ] || exit 1
if [ -n "$NEW_DB" ]; then
  [ -f "$BACKUP_DIR/database-backup-${RUN_ID}.ready" ] || exit 1
  python3 - "$NEW_DB" "$ENV_FILE" "$RUN_ID" <<'PY'
import os, pathlib, re, sys, tempfile
name, filename, run_id = sys.argv[1:]
p = pathlib.Path(filename)
text = p.read_text()
line = 'DB_NAME=' + name
pattern = r'^\s*DB_NAME\s*=.*$'
text = re.sub(pattern, lambda match: line, text, flags=re.M) if re.search(pattern, text, re.M) else text.rstrip() + '\n' + line + '\n'
fd, temporary = tempfile.mkstemp(prefix=p.name + '.tmp-' + run_id + '-', dir=str(p.parent))
try:
    with os.fdopen(fd, 'w') as output:
        os.fchmod(output.fileno(), 0o600)
        os.fchown(output.fileno(), 0, 0)
        output.write(text)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, p)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
fi
chown hourglass:hourglass "$REMOTE_STAGE/$JAR_NAME.new"
mv -T -- "$REMOTE_STAGE/$JAR_NAME.new" "$APP_DIR/$JAR_NAME"
echo "    · 新包大小：$(wc -c < "$APP_DIR/$JAR_NAME") bytes"
systemctl restart "$SERVICE"
sleep 9
[ "$(systemctl is-active "$SERVICE")" = active ] || exit 1
LOG_PATH="$(read_env LOG_FILE)"
LOG_PATH="${LOG_PATH:-$APP_DIR/logs/hourglass.log}"
case "$LOG_PATH" in /*) ;; *) LOG_PATH="$APP_DIR/${LOG_PATH#./}" ;; esac
[ -s "$LOG_PATH" ] || { echo "应用日志未生成：$LOG_PATH" >&2; exit 1; }
echo "    · 应用日志：$LOG_PATH ($(wc -c < "$LOG_PATH") bytes)"
echo "    · 服务状态：$(systemctl is-active "$SERVICE")  开机自启：$(systemctl is-enabled "$SERVICE")"
REMOTE
  ok "后端重启完成"
fi

# ============================= 5. 校验 ========================================
if [ "$DO_VERIFY" -eq 1 ]; then
  step "5/6 校验（健康检查 / 产物一致性 / 前端哈希 / 登录）"
  # 校验脚本先落临时文件：heredoc 直接放在 $( ) 里时，内嵌引号会让本地 bash 解析报错
  VERIFY_TMP="${LOCAL_TMP}/verify.out"
  if ! sudo_do >"$VERIFY_TMP" 2>&1 <<'REMOTE'
VERIFY_DIR="$(mktemp -d "$REMOTE_STAGE/verify.XXXXXX")"
chmod 700 "$VERIFY_DIR"
trap 'rm -rf -- "$VERIFY_DIR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
B="http://127.0.0.1:${NGINX_PORT}"
COOKIE="$VERIFY_DIR/cookies.txt"
# Bootstrap CSRF, then obtain authenticated health after login to verify the live
# JDBC catalog, not merely the configured DB_NAME.
# 重启后端口先通、Spring 上下文与连接池可能还没就绪，首个健康请求会 503；
# 有界重试，避免把正常启动误判为部署失败。
for attempt in $(seq 1 30); do
  if curl -fsS -c "$COOKIE" -b "$COOKIE" -m 5 "$B/hourglass/api/health" -o "$VERIFY_DIR/health.json"; then
    break
  fi
  [ "$attempt" -lt 30 ] || { echo "健康检查在 60 秒内未就绪" >&2; exit 1; }
  sleep 2
done
echo "HEALTH $(< "$VERIFY_DIR/health.json")"
echo "ROOT $(curl -s -o /dev/null -w '%{http_code}' -m 10 "$B/hourglass/")"
echo "LOCAL_JAR $(sha256sum "$APP_DIR/$JAR_NAME" | cut -c1-16)"
STARTED="$(systemctl show "$SERVICE" -p ActiveEnterTimestamp --value)"
[ -n "$STARTED" ] || { echo "缺少本次服务启动时间" >&2; exit 1; }
echo "ERRORS $(journalctl -u "$SERVICE" --no-pager --since "$STARTED" | grep -icE 'ERROR|Caused by' || true)"
echo "CONFIG_DATABASE $(read_env DB_NAME)"
for f in "${VERIFY_FILES[@]}"; do
  o="$VERIFY_DIR/${f//\//_}"
  curl -fsS -m 15 "$B/hourglass/$f" -o "$o"
  echo "FILE $f $(wc -c < "$o" | tr -d ' ') $(sha256sum "$o" | cut -c1-16)"
done
# Credentials remain only on the server and are never printed.
AU="$(read_env AUTH_USER)"
AP="$(read_env AUTH_PASSWORD)"
CRYPTO="$(read_env AI_CRYPTO_KEY)"
case "$CRYPTO" in ""|"''"|'""'|*hourglass-local-ai-key-change-me*|*改成随机长字符串*) echo "CRYPTO 0" ;; *) echo "CRYPTO 1" ;; esac
T="$(awk '/XSRF-TOKEN/{print $NF}' "$COOKIE")"
curl -fsS -m 15 -b "$COOKIE" -c "$COOKIE" -H "X-XSRF-TOKEN: $T" \
  --data-urlencode "username=$AU" --data-urlencode "password=$AP" \
  "$B/hourglass/api/auth/login" -o "$VERIFY_DIR/login.json"
echo "LOGIN $(< "$VERIFY_DIR/login.json")"
curl -fsS -m 10 -b "$COOKIE" -c "$COOKIE" "$B/hourglass/api/health" -o "$VERIFY_DIR/auth-health.json"
ACTUAL_DB="$(python3 - "$VERIFY_DIR/auth-health.json" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    result = json.load(source)
data = result.get('data') or {}
if result.get('code') != 0 or data.get('db') != 'up' or not isinstance(data.get('database'), str):
    raise SystemExit('Authenticated health lacks live JDBC database evidence')
print(data['database'])
PY
)"
echo "DATABASE $ACTUAL_DB"
LOG_PATH="$(read_env LOG_FILE)"
LOG_PATH="${LOG_PATH:-$APP_DIR/logs/hourglass.log}"
case "$LOG_PATH" in /*) ;; *) LOG_PATH="$APP_DIR/${LOG_PATH#./}" ;; esac
echo "LOGFILE $LOG_PATH $([ -f "$LOG_PATH" ] && wc -c < "$LOG_PATH" || echo 0)"
echo "MEM $(systemctl show "$SERVICE" -p MemoryCurrent --value | awk '{printf "%.0f", $1/1048576}')"
REMOTE
  then
    err "线上校验中断，远端输出如下："
    sed 's/^/      /' "$VERIFY_TMP" >&2
    rm -f "$VERIFY_TMP"
    die "校验未完成；jar/前端/数据库可能已更新，请按上方输出核对或回滚"
  fi
  VERIFY_OUT="$(cat "$VERIFY_TMP")"
  rm -f "$VERIFY_TMP"

  VERIFY_FAIL=0

  HEALTH="$(vget HEALTH | sed 's/^HEALTH //')"
  if printf '%s' "$HEALTH" | grep -q '"db":"up"'; then ok "健康检查：db up"; else err "健康检查异常：$HEALTH"; VERIFY_FAIL=1; fi

  ROOT_CODE="$(vget ROOT | awk '{print $2}')"
  if [ "$ROOT_CODE" = "200" ]; then ok "前端入口：HTTP 200"; else err "前端入口异常：HTTP ${ROOT_CODE}"; VERIFY_FAIL=1; fi

  if [ "$NEED_JAR" -eq 1 ]; then
    REMOTE_JAR_SHA="$(vget LOCAL_JAR | awk '{print $2}')"
    if [ "$REMOTE_JAR_SHA" = "$LOCAL_JAR_SHA" ]; then ok "线上 jar 与本地一致（sha256 前16=${LOCAL_JAR_SHA}）"; else err "jar 哈希不一致：本地 ${LOCAL_JAR_SHA} / 线上 ${REMOTE_JAR_SHA}"; VERIFY_FAIL=1; fi
  fi

  if [ "$NEED_FRONT" -eq 1 ]; then
    while read -r _ f sz h; do
      if [ -f "frontend/$f" ]; then
        lh="$(sha256sum "frontend/$f" | cut -c1-16)"
        lsz="$(wc -c < "frontend/$f" | tr -d ' ')"
        if [ "$lh" = "$h" ] && [ "$lsz" = "$sz" ]; then
          printf '    %s✓%s %-14s %8s bytes  %s\n' "$C_OK" "$C_RST" "$f" "$sz" "$h"
        else
          printf '    %s✗%s %-14s 本地(%s/%s) ≠ 线上(%s/%s)\n' "$C_ERR" "$C_RST" "$f" "$lsz" "$lh" "$sz" "$h"
          VERIFY_FAIL=1
        fi
      fi
    done < <(printf '%s\n' "$VERIFY_OUT" | grep '^FILE ')
  fi

  LOGIN="$(vget LOGIN | sed 's/^LOGIN //')"
  if printf '%s' "$LOGIN" | grep -q '"code":0'; then ok "管理员登录正常"; else err "登录失败：$LOGIN"; VERIFY_FAIL=1; fi

  ERRS="$(vget ERRORS | awk '{print $2}')"
  if [ "${ERRS:-0}" = "0" ]; then ok "本次启动后的日志无 ERROR"; else err "本次启动后有 ${ERRS} 行 ERROR/Caused by"; VERIFY_FAIL=1; fi
  REMOTE_DB="$(vget DATABASE | cut -d ' ' -f2-)"
  CONFIG_DB="$(vget CONFIG_DATABASE | cut -d ' ' -f2-)"
  if [ "$REMOTE_DB" = "$TARGET_DB" ] && [ "$CONFIG_DB" = "$TARGET_DB" ]; then
    ok "登录后 JDBC 实际数据库与配置均匹配：${TARGET_DB}"
  else
    err "数据库目标不一致：期望 ${TARGET_DB} / JDBC ${REMOTE_DB:-缺失} / 配置 ${CONFIG_DB:-缺失}"
    VERIFY_FAIL=1
  fi

  CRYPTO="$(vget CRYPTO | awk '{print $2}')"
  if [ "${CRYPTO:-0}" = "0" ]; then
    err "未配置独立 AI_CRYPTO_KEY：请在 ${ENV_FILE} 中设置随机长字符串后重新部署"
    VERIFY_FAIL=1
  else
    ok "AI_CRYPTO_KEY 已配置"
  fi

  MEM="$(vget MEM | awk '{print $2}')"
  info "应用内存占用：${MEM} MB"

  REMOTE_LOG="$(vget LOGFILE | awk '{print $2}')"
  LOG_BYTES="$(vget LOGFILE | awk '{print $3}')"
  case "$LOG_BYTES" in ''|*[!0-9]*) LOG_BYTES=0 ;; esac
  if [ "$LOG_BYTES" -gt 0 ]; then
    ok "应用日志已生成：${REMOTE_LOG}（${LOG_BYTES} bytes）"
  else
    err "应用日志缺失或为空：${REMOTE_LOG:-未返回路径}"
    VERIFY_FAIL=1
  fi

  [ "$VERIFY_FAIL" -eq 0 ] || die "校验未通过，部署结果不可信。可执行 bash deploy/deploy.sh --rollback 回滚"
else
  step "5/6 校验：已按 --no-verify 跳过"
fi

# ============================= 6. 记录状态 ====================================
step "6/6 记录部署状态"
mv -f "$PENDING_STAMP" "$STATE_STAMP"
info "已更新部署基准：${STATE_STAMP}"
info "基准时间：$(date -r "$STATE_STAMP" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo '未知')"
info "（下次运行时以此文件的 mtime 判断改动范围）"

printf '\n%s部署完成%s\n' "$C_OK" "$C_RST"
printf '  访问地址：%s\n' "$PUBLIC_URL"
printf '  回滚命令：bash deploy/deploy.sh --rollback\n\n'
