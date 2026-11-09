#!/usr/bin/env bash
# =============================================================================
# 沙漏 Hourglass · 一键部署脚本（前后端分离版）
#
# 用法（在项目根目录执行）：
#   bash deploy/deploy.sh              自动判断改动范围后部署（推荐日常使用）
#   bash deploy/deploy.sh --dry-run    只检测改了什么、要走哪些步骤，不实际执行
#   bash deploy/deploy.sh --force      即使没检测到改动也强制重新部署
#   bash deploy/deploy.sh --sql-all    强制按顺序重放 sql/ 根目录的增量脚本（幂等）
#   bash deploy/deploy.sh --no-verify  跳过登录/哈希校验（快，但不推荐）
#   bash deploy/deploy.sh --rollback   回滚到最近一次的 jar 与前端备份
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
#   /opt/hourglass/frontend.bak-<时间>/        前端备份
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
KEEP_JAR_BAK=3                           # 服务器上保留最近 N 份 jar 备份
KEEP_FRONT_BAK=3                         # 服务器上保留最近 N 份前端备份
KEEP_DB_BAK=14                           # 部署前库备份保留天数（天）

NGINX_PORT="${NGINX_PORT:-8081}"            # 对外 nginx 端口（目标机 nginx 监听 80 时：NGINX_PORT=80）
APP_PORT="${APP_PORT:-8082}"                # 应用内部端口（仅本机）
PUBLIC_URL="http://${HOST}:${NGINX_PORT}/hourglass"

MVN="${MVN:-mvn}"

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

ssh_do()  { ssh -T "${SSH_OPTS[@]}" -p "$SSH_PORT" "${SSH_USER}@${HOST}" "$@"; }
sudo_do() { ssh -T "${SSH_OPTS[@]}" -p "$SSH_PORT" "${SSH_USER}@${HOST}" 'sudo bash -s'; }

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
    -h|--help)   sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           die "未知参数：$arg（用 --help 查看用法）" ;;
  esac
done

# ============================= 回滚流程 ======================================
if [ "$ROLLBACK" -eq 1 ]; then
  step "回滚到最近一次 jar / 前端备份"
  sudo_do <<REMOTE
set -e
cd ${APP_DIR}
TS="\$(date +%Y%m%d-%H%M%S)"
LATEST_JAR="\$(ls -1t ${JAR_NAME}.bak-* 2>/dev/null | head -1 || true)"
LATEST_FRONT="\$(ls -1dt frontend.bak-* 2>/dev/null | head -1 || true)"
if [ -z "\$LATEST_JAR" ] && [ -z "\$LATEST_FRONT" ]; then echo "NO_BACKUP"; exit 1; fi

if [ -n "\$LATEST_JAR" ]; then
  echo "  · jar 备份：\$LATEST_JAR"
  cp -a "\$LATEST_JAR" ${JAR_NAME}
  chown hourglass:hourglass ${JAR_NAME}
else
  echo "  · 没有 jar 备份，保持当前后端"
fi

if [ -n "\$LATEST_FRONT" ]; then
  echo "  · 前端备份：\$LATEST_FRONT"
  [ -d ${FRONT_DIR} ] && mv ${FRONT_DIR} frontend.failed-\${TS}
  cp -a "\$LATEST_FRONT" ${FRONT_DIR}
  chown -R hourglass:hourglass ${FRONT_DIR}
else
  echo "  · 没有前端备份，保持当前前端"
fi

if [ -n "\$LATEST_JAR" ]; then
  systemctl restart ${SERVICE}
  sleep 8
  echo "状态: \$(systemctl is-active ${SERVICE})"
else
  echo "前端已回滚（无需重启后端）"
fi
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
if printf '%s\n' "$CHANGED_ALL" | grep -qE '(^|/)src/.*\.(java|xml)$|pom\.xml$'; then HAS_BACKEND=1; fi
HAS_FRONTEND=0
if printf '%s\n' "$CHANGED_ALL" | grep -qE '(^|/)frontend/'; then HAS_FRONTEND=1; fi

NEED_DB=0; [ -n "${CHANGED_SQL// /}" ] && NEED_DB=1
NEED_JAR=0
if [ "$HAS_BACKEND" -eq 1 ] || [ "$FORCE" -eq 1 ]; then NEED_JAR=1; fi
NEED_FRONT=0
if [ "$HAS_FRONTEND" -eq 1 ] || [ "$FORCE" -eq 1 ]; then NEED_FRONT=1; fi

echo
info "改动判定："
info "  后端 Java/资源 : $([ $HAS_BACKEND -eq 1 ] && echo '有（需重新打包 jar）' || echo '无')"
info "  前端静态资源   : $([ $HAS_FRONTEND -eq 1 ] && echo '有（需重新打包 frontend）' || echo '无')"
info "  数据库脚本     : $([ $NEED_DB -eq 1 ] && echo "有 → ${CHANGED_SQL}（需先备份库）" || echo '无（跳过数据库步骤）')"
info "  部署动作       : jar=$([ $NEED_JAR -eq 1 ] && echo '发布' || echo '跳过')  frontend=$([ $NEED_FRONT -eq 1 ] && echo '发布' || echo '跳过')  db=$([ $NEED_DB -eq 1 ] && echo '执行' || echo '跳过')"

if [ "$DRY_RUN" -eq 1 ]; then
  step "dry-run：仅预览，未执行任何变更"
  exit 0
fi

if [ -z "$CHANGED_ALL" ] && [ "$FORCE" -eq 0 ]; then
  warn "未检测到任何改动。如需强制重新部署请加 --force"
  exit 0
fi

PENDING_STAMP="${SCRIPT_DIR}/.pending-deploy.stamp"
touch "$PENDING_STAMP"

# ============================= 2. 本地构建 ====================================
step "2/6 本地构建"

JAR_PATH="${PROJECT_DIR}/backend/target/${JAR_NAME}"
DIST_DIR="${PROJECT_DIR}/deploy/dist"
FRONT_STAGE="${DIST_DIR}/frontend-pkg"
FRONT_TAR="${DIST_DIR}/hourglass-frontend.tar.gz"
mkdir -p "$DIST_DIR"

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
  info "后端：$MVN -B -DskipTests -f backend/pom.xml clean package"
  if ! BUILD_OUT="$("$MVN" -B -DskipTests -f backend/pom.xml clean package 2>&1)"; then
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
  tar -czf "$FRONT_TAR" -C "$FRONT_STAGE" hourglass
  LOCAL_FRONT_SIZE="$(wc -c < "$FRONT_TAR" | tr -d ' ')"
  LOCAL_FRONT_SHA="$(sha256sum "$FRONT_TAR" | cut -c1-16)"
  ok "frontend：$(ls -lh "$FRONT_TAR" | awk '{print $5}')  sha256(前16)=${LOCAL_FRONT_SHA}"
else
  info "前端：无改动，跳过打包"
fi

# ============================= 3. 数据库（按需） ==============================
if [ "$NEED_DB" -eq 1 ]; then
  step "3/6 数据库：备份整库 → 执行变更脚本"
  info "待执行：${CHANGED_SQL}"

  for f in $CHANGED_SQL; do
    scp "${SCP_OPTS[@]}" -P "$SSH_PORT" "$f" "${SSH_USER}@${HOST}:/tmp/deploy-sql-$(basename "$f")" >/dev/null \
      || die "上传 SQL 失败：$f"
  done
  ok "SQL 脚本已上传"

  sudo_do <<'REMOTE'
set -e
DB_PW="$(sed -n 's/^DB_PASSWORD=//p' /etc/hourglass.env)"
[ -n "$DB_PW" ] || { echo "无法从 /etc/hourglass.env 读取 DB_PASSWORD"; exit 1; }
mkdir -p /opt/hourglass/backup
TS="$(date +%Y%m%d-%H%M%S)"
BK="/opt/hourglass/backup/hourglass-pre-deploy-${TS}.sql.gz"
echo "  · 备份整库 → $BK"
mysqldump -u hourglass -p"$DB_PW" --single-transaction --no-tablespaces --routines --triggers hourglass | gzip > "$BK"
echo "    备份大小：$(du -h "$BK" | cut -f1)  表数：$(zcat "$BK" | grep -c 'CREATE TABLE' || true)"
echo "  · 清理超过 14 天的库备份"
find /opt/hourglass/backup -name 'hourglass-*.sql.gz' -mtime +14 -delete
REMOTE
  ok "整库备份完成"

  for f in $(printf '%s\n' $CHANGED_SQL | sort); do
    base="$(basename "$f")"
    info "执行 ${base}"
    sudo_do <<REMOTE
set -e
DB_PW="\$(sed -n 's/^DB_PASSWORD=//p' /etc/hourglass.env)"
mysql -u hourglass -p"\$DB_PW" hourglass < /tmp/deploy-sql-${base}
rm -f /tmp/deploy-sql-${base}
echo "    \$(mysql -u hourglass -p"\$DB_PW" -N -e 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema="hourglass";') 张表"
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
  scp "${SCP_OPTS[@]}" -P "$SSH_PORT" "$JAR_PATH" "${SSH_USER}@${HOST}:/tmp/${JAR_NAME}.new" >/dev/null \
    || die "上传 jar 失败"
  ok "jar 上传完成"
fi

if [ "$NEED_FRONT" -eq 1 ]; then
  info "上传前端包（$(ls -lh "$FRONT_TAR" | awk '{print $5}')）"
  scp "${SCP_OPTS[@]}" -P "$SSH_PORT" "$FRONT_TAR" "${SSH_USER}@${HOST}:/tmp/hourglass-frontend.tar.gz.new" >/dev/null \
    || die "上传前端包失败"
  ok "前端包上传完成"
fi

if [ "$NEED_FRONT" -eq 1 ]; then
  sudo_do <<REMOTE
set -e
TS="\$(date +%Y%m%d-%H%M%S)"
mkdir -p ${APP_DIR}
rm -rf ${FRONT_DIR}.new
mkdir -p ${FRONT_DIR}.new
tar -xzf /tmp/hourglass-frontend.tar.gz.new -C ${FRONT_DIR}.new
[ -f ${FRONT_DIR}.new/hourglass/index.html ] || { echo "前端包缺少 hourglass/index.html"; exit 1; }
if [ -d ${FRONT_DIR} ]; then
  mv ${FRONT_DIR} ${APP_DIR}/frontend.bak-\${TS}
  echo "    · 旧前端已备份：frontend.bak-\${TS}"
fi
mv ${FRONT_DIR}.new ${FRONT_DIR}
chown -R hourglass:hourglass ${FRONT_DIR}
echo "    · 前端文件数：\$(find ${FRONT_DIR} -type f | wc -l)"
ls -1dt ${APP_DIR}/frontend.bak-* 2>/dev/null | tail -n +$((KEEP_FRONT_BAK+1)) | while read f; do rm -rf "\$f"; echo "    · 清理旧前端备份 \$(basename \$f)"; done
rm -f /tmp/hourglass-frontend.tar.gz.new
REMOTE
  ok "前端发布完成"
fi

if [ "$NEED_JAR" -eq 1 ]; then
  sudo_do <<REMOTE
set -e
cd ${APP_DIR}
TS="\$(date +%Y%m%d-%H%M%S)"
BAK="${JAR_NAME}.bak-\${TS}"
if [ -f ${JAR_NAME} ]; then
  cp -a ${JAR_NAME} "\$BAK"
  echo "    · 旧包已备份：\$BAK"
fi
mv /tmp/${JAR_NAME}.new ${JAR_NAME}
chown hourglass:hourglass ${JAR_NAME}
echo "    · 新包大小：\$(ls -lh ${JAR_NAME} | awk '{print \$5}')"
ls -1t ${JAR_NAME}.bak-* 2>/dev/null | tail -n +$((KEEP_JAR_BAK+1)) | while read f; do rm -f "\$f"; echo "    · 清理旧备份 \$(basename \$f)"; done
systemctl restart ${SERVICE}
sleep 9
echo "    · 服务状态：\$(systemctl is-active ${SERVICE})  开机自启：\$(systemctl is-enabled ${SERVICE})"
REMOTE
  ok "后端重启完成"
fi

# ============================= 5. 校验 ========================================
if [ "$DO_VERIFY" -eq 1 ]; then
  step "5/6 校验（健康检查 / 产物一致性 / 前端哈希 / 登录）"
  # 校验脚本先落临时文件：heredoc 直接放在 $( ) 里时，内嵌引号会让本地 bash 解析报错
  VERIFY_TMP="$(mktemp)"
  sudo_do >"$VERIFY_TMP" 2>&1 <<REMOTE
set +e
B=http://127.0.0.1:${NGINX_PORT}

cd /tmp && rm -f dv.txt
# 先调健康接口拿到 CSRF cookie（静态页由 Nginx 直出，不会带 Set-Cookie）
echo "HEALTH \$(curl -s -c dv.txt -b dv.txt -m 10 \$B/hourglass/api/health)"
echo "ROOT \$(curl -s -o /dev/null -w '%{http_code}' -m 10 \$B/hourglass/)"
echo "LOCAL_JAR \$(sha256sum ${APP_DIR}/${JAR_NAME} | cut -c1-16)"
echo "ERRORS \$(journalctl -u ${SERVICE} --no-pager -n 60 | grep -icE 'ERROR|Caused by' || true)"
cd /tmp && rm -rf dv && mkdir dv && cd dv
for f in ${VERIFY_FILES[*]}; do
  o=\$(echo "\$f" | tr '/' '_')
  curl -s -m 15 "\$B/hourglass/\$f" -o "\$o"
  echo "FILE \$f \$(wc -c < "\$o" | tr -d ' ') \$(sha256sum "\$o" | cut -c1-16)"
done
rm -rf /tmp/dv
# 登录校验（凭据只在服务器端读取，不外传）
DB_PW="\$(sed -n 's/^DB_PASSWORD=//p' ${ENV_FILE})"
AU="\$(sed -n 's/^AUTH_USER=//p' ${ENV_FILE})"
AP="\$(sed -n 's/^AUTH_PASSWORD=//p' ${ENV_FILE})"
CRYPTO="\$(sed -n 's/^AI_CRYPTO_KEY=//p' ${ENV_FILE})"
case "\$CRYPTO" in ""|"''"|'""'|*hourglass-local-ai-key-change-me*|*改成随机长字符串*) echo "CRYPTO 0" ;; *) echo "CRYPTO 1" ;; esac
T=\$(awk '/XSRF-TOKEN/{print \$NF}' /tmp/dv.txt)
echo "LOGIN \$(curl -s -b /tmp/dv.txt -c /tmp/dv.txt -H "X-XSRF-TOKEN: \$T" -d "username=\$AU&password=\$AP" \$B/hourglass/api/auth/login)"
echo "MEM \$(systemctl show ${SERVICE} -p MemoryCurrent --value | awk '{printf "%.0f", \$1/1048576}')"
rm -f /tmp/dv.txt
REMOTE
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
  if [ "${ERRS:-0}" = "0" ]; then ok "启动日志无 ERROR"; else warn "启动日志有 ${ERRS} 行含 ERROR/Caused by，请核查：journalctl -u ${SERVICE} -n 100"; fi

  CRYPTO="$(vget CRYPTO | awk '{print $2}')"
  if [ "${CRYPTO:-0}" = "0" ]; then
    err "未配置独立 AI_CRYPTO_KEY：请在 ${ENV_FILE} 中设置随机长字符串后重新部署"
    VERIFY_FAIL=1
  else
    ok "AI_CRYPTO_KEY 已配置"
  fi

  MEM="$(vget MEM | awk '{print $2}')"
  info "应用内存占用：${MEM} MB"

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
