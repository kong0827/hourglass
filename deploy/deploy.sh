#!/usr/bin/env bash
# =============================================================================
# 沙漏 Hourglass · 一键部署脚本
#
# 用法（在项目根目录执行）：
#   bash deploy/deploy.sh              自动判断改动范围后部署（推荐日常使用）
#   bash deploy/deploy.sh --dry-run    只检测改了什么、要走哪些步骤，不实际执行
#   bash deploy/deploy.sh --force      即使没检测到改动也强制重新部署
#   bash deploy/deploy.sh --sql-all     强制按顺序重放 sql/ 根目录的增量脚本（幂等）
#   bash deploy/deploy.sh --no-verify  跳过登录/哈希校验（快，但不推荐）
#   bash deploy/deploy.sh --rollback   回滚到服务器上最近一次的 jar 备份
#
# 自动判断逻辑：
#   - 改动含 sql/*.sql  → 先备份整库，再按文件名顺序执行改动的脚本，然后换包
#   - 只改 Java/前端    → 跳过数据库步骤，直接换包重启
#   - 什么都没改        → 提示并退出（除非 --force）
#
# 依赖：本地 mvn + java；能免密 SSH 到服务器；服务器上 sudo 免密
# =============================================================================
set -euo pipefail

# ------------------------------- 配置区 --------------------------------------
HOST="${DEPLOY_HOST:-124.223.208.134}"
SSH_USER="${DEPLOY_USER:-ubuntu}"
SSH_PORT="${DEPLOY_PORT:-22}"

APP_DIR="/opt/hourglass"                 # 服务器应用目录
SERVICE="hourglass"                      # systemd 服务名
JAR_NAME="hourglass-server.jar"
ENV_FILE="/etc/hourglass.env"            # 服务器环境变量文件（含 DB/AUTH 凭据）
BACKUP_DIR="${APP_DIR}/backup"
KEEP_JAR_BAK=3                           # 服务器上保留最近 N 份 jar 备份
KEEP_DB_BAK=14                           # 部署前库备份保留天数（天）

NGINX_PORT=8081                          # 对外 nginx 端口
APP_PORT=8082                            # 应用内部端口（仅本机）
PUBLIC_URL="http://${HOST}:${NGINX_PORT}/hourglass"

MVN="${MVN:-mvn}"

# 需要做字节级校验的前端文件（相对 static 目录）
# 2026-11-01 CODE-5：app.js 拆为原生 ES Module（core/lib/views），校验清单同步为模块文件。
VERIFY_FILES=(
  "index.html"
  "login.html"
  "join.html"
  "manifest.webmanifest"
  "share.html"
  "sw.js"
  "js/main.js"
  "js/share.js"
  "js/core/api.js"
  "js/core/app.js"
  "js/core/dom.js"
  "js/core/filters-ui.js"
  "js/core/filters.js"
  "js/core/icons.js"
  "js/core/notifications.js"
  "js/core/realtime.js"
  "js/core/router.js"
  "js/core/shell.js"
  "js/core/shortcuts.js"
  "js/core/state.js"
  "js/core/task-actions.js"
  "js/core/task-drawer.js"
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
  "js/views/gantt.js"
  "js/views/list.js"
  "js/views/mine.js"
  "js/views/profile.js"
  "js/views/projects.js"
  "js/views/requirements.js"
  "js/views/review.js"
  "js/views/settings.js"
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
# 为什么不用时间字符串 + `find -newermt`：Git Bash 的 `date -d` 对 "X -2 seconds"
# 这类相对表达式会解析错（实测把 15:40 算成了次日 01:40），导致漏检改动；
# 戳记文件直接比 mtime，无任何时间解析，且带纳秒精度，不存在同秒漏检问题。
STATE_STAMP="${SCRIPT_DIR}/.last-deploy.stamp"
# 安全说明：保留正常的主机密钥校验（不设 StrictHostKeyChecking=no / UserKnownHostsFile=/dev/null）。
# 关掉校验等于放弃中间人攻击防护，且会被主机安全策略拦截。
# 首次连接某台服务器时，先把指纹加入 known_hosts 即可（ssh-keyscan 或首次交互确认）。
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

# 从校验输出（变量，不是文件）中取指定前缀的行。
# 注意：必须用管道把内容喂给 grep；直接把变量当参数写会变成"拿内容当文件名"，
# 且 grep 的报错是多行的，肉眼很容易误当成正常输出。
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
    -h|--help)   sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           die "未知参数：$arg（用 --help 查看用法）" ;;
  esac
done

# ============================= 回滚流程 ======================================
if [ "$ROLLBACK" -eq 1 ]; then
  step "回滚到最近一次 jar 备份"
  sudo_do <<REMOTE
set -e
cd ${APP_DIR}
LATEST=\$(ls -1t ${JAR_NAME}.bak-* 2>/dev/null | head -1) || true
if [ -z "\$LATEST" ]; then echo "NO_BACKUP"; exit 1; fi
echo "使用备份：\$LATEST"
cp -a "\$LATEST" ${JAR_NAME}
chown hourglass:hourglass ${JAR_NAME}
systemctl restart ${SERVICE}
sleep 8
echo "状态: \$(systemctl is-active ${SERVICE})"
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

# 与戳记文件的 mtime 比对；无戳记则全部视为改动
changed() {
  if [ -f "$STATE_STAMP" ]; then
    find "$@" -type f -not -path '*/target/*' -newer "$STATE_STAMP" 2>/dev/null
  else
    find "$@" -type f -not -path '*/target/*' 2>/dev/null
  fi
}

# 完整基线会删表、种子会重灌演示数据，只允许手工执行，不纳入自动部署改动检测
CHANGED_ALL="$(changed src sql pom.xml | grep -vE '^sql/(baseline|seeds)/' || true)"
if [ -n "$CHANGED_ALL" ]; then
  printf '%s\n' "$CHANGED_ALL" | sed 's/^/      /'
else
  info "（无改动）"
fi

CHANGED_SQL=""
for f in $(find sql -maxdepth 1 -name '*.sql' 2>/dev/null | sort); do
  if [ "$SQL_ALL" -eq 1 ] || [ ! -f "$STATE_STAMP" ]; then CHANGED_SQL="${CHANGED_SQL}${f} "; continue; fi
  # 注意：CHANGED_ALL 是多行文本（行尾是换行）。早前用 `case " $CHANGED_ALL " in *" $f "*)`
  # 判断，模式要求前后都有空格，而行尾是换行，导致"改了 SQL 却判定为无 DB 变更、直接跳过
  # 建表加列步骤"，上线后运行期才报未知表/未知列。这里改成逐行精确匹配（-x -F）。
  if printf '%s\n' "$CHANGED_ALL" | grep -qxF "$f"; then
    CHANGED_SQL="${CHANGED_SQL}${f} "
  fi
done

HAS_BACKEND=0
if printf '%s\n' "$CHANGED_ALL" | grep -qE '(^|/)src/.*\.(java|xml)$|pom\.xml$'; then HAS_BACKEND=1; fi
HAS_FRONTEND=0
if printf '%s\n' "$CHANGED_ALL" | grep -qE '(^|/)src/main/resources/static/'; then HAS_FRONTEND=1; fi

NEED_DB=0; [ -n "${CHANGED_SQL// /}" ] && NEED_DB=1

echo
info "改动判定："
info "  后端 Java/资源 : $([ $HAS_BACKEND -eq 1 ] && echo '有（需重新打包）' || echo '无')"
info "  前端静态资源   : $([ $HAS_FRONTEND -eq 1 ] && echo '有（打进 jar，仍需重新打包）' || echo '无')"
info "  数据库脚本     : $([ $NEED_DB -eq 1 ] && echo "有 → ${CHANGED_SQL}（需先备份库）" || echo '无（跳过数据库步骤）')"
if [ -z "$CHANGED_ALL" ] && [ "$FORCE" -eq 0 ]; then
  info "  部署动作       : 无（未检测到改动）"
elif [ "$NEED_DB" -eq 1 ]; then
  info "  部署动作       : 备份库 → 执行 SQL → 换包重启"
else
  info "  部署动作       : 换包重启（不动数据库）"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  step "dry-run：仅预览，未执行任何变更"
  exit 0
fi

if [ -z "$CHANGED_ALL" ] && [ "$FORCE" -eq 0 ]; then
  warn "未检测到任何改动。如需强制重新部署请加 --force"
  exit 0
fi

# 记录本次部署的"起点"：用一个 pending 文件的 mtime 承载，成功后改名成正式基准。
# 用起点而非终点，避免部署过程中新产生的改动被漏检（宁可下次多构建一次）。
PENDING_STAMP="${SCRIPT_DIR}/.pending-deploy.stamp"
touch "$PENDING_STAMP"

# ============================= 2. 本地打包 ====================================
step "2/6 本地打包"

# 打包前硬校验：MyBatis 的 resultType 短别名只能解析 mybatis.type-aliases-package
# （= com.devstudio.kanban.entity）。若在 mapper XML 里写 dto 包的短名（如 ReqDocView），
# 打包会成功、运行期启动时报 "Could not resolve type alias" 直接起不来。
# 2026-10-21 就是这么把线上搞挂的，这里提前拦住。
ALIAS_BAD=""
while read -r _alias; do
  [ -n "$_alias" ] || continue
  case "$_alias" in
    int|integer|long|short|byte|float|double|boolean|String|string|map|Map|list|List|object|date|Date|bigdecimal|BigDecimal|void) continue ;;
  esac
  [ -f "${PROJECT_DIR}/src/main/java/com/devstudio/kanban/entity/${_alias}.java" ] || ALIAS_BAD="${ALIAS_BAD} ${_alias}"
done < <(grep -rhoE 'resultType="[A-Za-z_][A-Za-z0-9_]*"' "${PROJECT_DIR}"/src/main/resources/mapper/*.xml 2>/dev/null | sed 's/.*="//;s/"//' | sort -u || true)
if [ -n "$ALIAS_BAD" ]; then
  die "mapper 里有无法解析的短别名：${ALIAS_BAD}
      这些类型不在 entity 包（mybatis.type-aliases-package）里，写全限定名即可，例如
      resultType=\"com.devstudio.kanban.dto.ReqDocView\"
      已中止部署（服务器未受任何影响）"
fi

command -v "$MVN" >/dev/null 2>&1 || die "找不到 mvn，请确认 Maven 已装且在 PATH 中"
info "执行：$MVN -B -DskipTests clean package"
# 用变量承载构建输出（不用临时文件：部分受限 shell 会拦截 rm，导致脚本莫名中断）
if ! BUILD_OUT="$("$MVN" -B -DskipTests clean package 2>&1)"; then
  printf '%s\n' "$BUILD_OUT" | tail -30 >&2
  die "打包失败，已中止部署（服务器未受任何影响）"
fi
printf '%s\n' "$BUILD_OUT" | grep -E 'BUILD SUCCESS|Total time' | sed 's/^/      /' || true

JAR_PATH="${PROJECT_DIR}/target/${JAR_NAME}"
[ -f "$JAR_PATH" ] || die "未找到构建产物：$JAR_PATH"
LOCAL_JAR_SIZE="$(wc -c < "$JAR_PATH" | tr -d ' ')"
LOCAL_JAR_SHA="$(sha256sum "$JAR_PATH" | cut -c1-16)"
ok "产物：$(ls -lh "$JAR_PATH" | awk '{print $5}')  sha256(前16)=${LOCAL_JAR_SHA}"

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

  # 按文件名顺序执行，保证 02 在 01 之后
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
JAR_MB="$(awk -v s="$LOCAL_JAR_SIZE" 'BEGIN{printf "%.1f", s/1048576}')"
info "上传 jar（${JAR_MB}MB）"
scp "${SCP_OPTS[@]}" -P "$SSH_PORT" "$JAR_PATH" "${SSH_USER}@${HOST}:/tmp/${JAR_NAME}.new" >/dev/null \
  || die "上传 jar 失败"
ok "上传完成"

sudo_do <<REMOTE
set -e
cd ${APP_DIR}
TS="\$(date +%Y%m%d-%H%M%S)"
BAK="${JAR_NAME}.bak-\${TS}"
cp -a ${JAR_NAME} "\$BAK"
echo "    · 旧包已备份：\$BAK"
mv /tmp/${JAR_NAME}.new ${JAR_NAME}
chown hourglass:hourglass ${JAR_NAME}
echo "    · 新包大小：\$(ls -lh ${JAR_NAME} | awk '{print \$5}')"
ls -1t ${JAR_NAME}.bak-* 2>/dev/null | tail -n +$((KEEP_JAR_BAK+1)) | while read f; do rm -f "\$f"; echo "    · 清理旧备份 \$(basename \$f)"; done
systemctl restart ${SERVICE}
sleep 9
echo "    · 服务状态：\$(systemctl is-active ${SERVICE})  开机自启：\$(systemctl is-enabled ${SERVICE})"
REMOTE
ok "重启完成"

# ============================= 5. 校验 ========================================
if [ "$DO_VERIFY" -eq 1 ]; then
  step "5/6 校验（健康检查 / jar 一致性 / 前端哈希 / 登录）"
  VERIFY_OUT="$(sudo_do 2>&1 <<REMOTE
set +e
B=http://127.0.0.1:${NGINX_PORT}

echo "HEALTH \$(curl -s -m 10 \$B/hourglass/api/health)"
echo "LOCAL_JAR \$(sha256sum ${APP_DIR}/${JAR_NAME} | cut -c1-16)"
echo "ERRORS \$(journalctl -u ${SERVICE} --no-pager -n 60 | grep -icE 'ERROR|Caused by' || true)"
cd /tmp && rm -rf dv && mkdir dv && cd dv
for f in ${VERIFY_FILES[*]}; do
  o=\$(echo "\$f" | tr '/' '_')
  curl -s -m 15 "\$B/\$f" -o "\$o"
  echo "FILE \$f \$(wc -c < "\$o" | tr -d ' ') \$(sha256sum "\$o" | cut -c1-16)"
done
rm -rf /tmp/dv
# 登录校验（凭据只在服务器端读取，不外传）
DB_PW="\$(sed -n 's/^DB_PASSWORD=//p' ${ENV_FILE})"
AU="\$(sed -n 's/^AUTH_USER=//p' ${ENV_FILE})"
AP="\$(sed -n 's/^AUTH_PASSWORD=//p' ${ENV_FILE})"
cd /tmp && rm -f dv.txt
curl -s -c dv.txt -o /dev/null \$B/hourglass/login.html
T=\$(awk '/XSRF-TOKEN/{print \$NF}' dv.txt)
echo "LOGIN \$(curl -s -b dv.txt -c dv.txt -H "X-XSRF-TOKEN: \$T" -d "username=\$AU&password=\$AP" \$B/hourglass/api/auth/login)"
echo "MEM \$(systemctl show ${SERVICE} -p MemoryCurrent --value | awk '{printf "%.0f", \$1/1048576}')"
rm -f /tmp/dv.txt
REMOTE
)"

  VERIFY_FAIL=0

  HEALTH="$(vget HEALTH | sed 's/^HEALTH //')"
  if printf '%s' "$HEALTH" | grep -q '"db":"up"'; then ok "健康检查：db up"; else err "健康检查异常：$HEALTH"; VERIFY_FAIL=1; fi

  REMOTE_JAR_SHA="$(vget LOCAL_JAR | awk '{print $2}')"
  if [ "$REMOTE_JAR_SHA" = "$LOCAL_JAR_SHA" ]; then ok "线上 jar 与本地一致（sha256 前16=${LOCAL_JAR_SHA}）"; else err "jar 哈希不一致：本地 ${LOCAL_JAR_SHA} / 线上 ${REMOTE_JAR_SHA}"; VERIFY_FAIL=1; fi

  # 用进程替换而非管道：管道会让循环跑在子 shell 中，VERIFY_FAIL 传不出来
  while read -r _ f sz h; do
    if [ -f "src/main/resources/static/$f" ]; then
      lh="$(sha256sum "src/main/resources/static/$f" | cut -c1-16)"
      lsz="$(wc -c < "src/main/resources/static/$f" | tr -d ' ')"
      if [ "$lh" = "$h" ] && [ "$lsz" = "$sz" ]; then
        printf '    %s✓%s %-14s %8s bytes  %s\n' "$C_OK" "$C_RST" "$f" "$sz" "$h"
      else
        printf '    %s✗%s %-14s 本地(%s/%s) ≠ 线上(%s/%s)\n' "$C_ERR" "$C_RST" "$f" "$lsz" "$lh" "$sz" "$h"
        VERIFY_FAIL=1
      fi
    fi
  done < <(printf '%s\n' "$VERIFY_OUT" | grep '^FILE ')

  LOGIN="$(vget LOGIN | sed 's/^LOGIN //')"
  if printf '%s' "$LOGIN" | grep -q '"code":0'; then ok "管理员登录正常"; else err "登录失败：$LOGIN"; VERIFY_FAIL=1; fi

  ERRS="$(vget ERRORS | awk '{print $2}')"
  if [ "${ERRS:-0}" = "0" ]; then ok "启动日志无 ERROR"; else warn "启动日志有 ${ERRS} 行含 ERROR/Caused by，请核查：journalctl -u ${SERVICE} -n 100"; fi

  MEM="$(vget MEM | awk '{print $2}')"
  info "应用内存占用：${MEM} MB"

  [ "$VERIFY_FAIL" -eq 0 ] || die "校验未通过，部署结果不可信。可执行 bash deploy/deploy.sh --rollback 回滚"
else
  step "5/6 校验：已按 --no-verify 跳过"
fi

# ============================= 6. 记录状态 ====================================
step "6/6 记录部署状态"
# 成功后才把"起点"升级为正式基准；中途失败则保留旧基准，下次会重新部署
mv -f "$PENDING_STAMP" "$STATE_STAMP"
info "已更新部署基准：${STATE_STAMP}"
info "基准时间：$(date -r "$STATE_STAMP" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo '未知')"
info "（下次运行时以此文件的 mtime 判断改动范围）"

printf '\n%s部署完成%s\n' "$C_OK" "$C_RST"
printf '  访问地址：%s\n' "$PUBLIC_URL"
printf '  回滚命令：bash deploy/deploy.sh --rollback\n\n'
