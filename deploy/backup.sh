#!/usr/bin/env bash
# 工作台每日备份：数据库 mysqldump + 附件目录打包，各保留最近 14 天
set -euo pipefail

BACKUP_DIR="/opt/devstudio/backup"
KEEP_DAYS=14
CRED_FILE="/etc/devstudio-backup.cnf"
ENV_FILE="/etc/devstudio.env"

# 从 env 文件按行提取 KEY=VALUE（不 source：AUTH_PASSWORD 等值里的 $ 会被 shell 展开或当成命令）
read_env() {
  local key="$1" file="$2" line value
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key="*) value="${line#*=}" ;;
      *) continue ;;
    esac
    value="${value%$'\r'}"
    value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    printf '%s' "$value"
    return 0
  done < "$file"
}

# 与应用共用目录配置（仅读取需要的两个键，其他内容一律不求值）
DB_NAME="$(read_env DB_NAME "$ENV_FILE")"
DB_NAME="${DB_NAME:-devstudio}"
ATTACH_DIR="$(read_env ATTACH_DIR "$ENV_FILE")"
ATTACH_DIR="${ATTACH_DIR:-/opt/devstudio/data/attachments}"
# 相对路径按应用工作目录解析（systemd WorkingDirectory=/opt/devstudio）
case "$ATTACH_DIR" in
  /*) ;;
  *) ATTACH_DIR="/opt/devstudio/${ATTACH_DIR#./}" ;;
esac

mkdir -p "$BACKUP_DIR"
WARN=0

# 1) 数据库（--no-tablespaces：库级授权账号无全局 PROCESS 权限时也能导出）
STAMP="$(date +%F_%H%M)"
DB_FILE="$BACKUP_DIR/devstudio-${STAMP}.sql.gz"
mysqldump --defaults-extra-file="$CRED_FILE" --single-transaction --no-tablespaces --routines --triggers "$DB_NAME" | gzip > "$DB_FILE"

# 2) 附件目录（必须存在；缺失/打包失败时显式告警并以非零码退出，不静默跳过）
if [ -d "$ATTACH_DIR" ]; then
  if tar -czf "$BACKUP_DIR/devstudio-attach-${STAMP}.tar.gz" -C "$ATTACH_DIR" .; then
    echo "[$(date '+%F %T')] attachments ok: $ATTACH_DIR"
  else
    echo "[$(date '+%F %T')] WARN: 附件打包失败：$ATTACH_DIR" >&2
    WARN=1
  fi
else
  echo "[$(date '+%F %T')] WARN: 附件目录不存在，未打包附件：$ATTACH_DIR（请检查 ATTACH_DIR 配置，应用首次上传附件后才会创建）" >&2
  WARN=1
fi

# 3) 清理超过保留期的备份
find "$BACKUP_DIR" -name 'devstudio-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'devstudio-attach-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

if [ "$WARN" -eq 1 ]; then
  echo "[$(date '+%F %T')] backup finished with warnings: $DB_FILE（附件未完整备份，见上方告警）" >&2
  exit 1
fi
echo "[$(date '+%F %T')] backup ok: $DB_FILE"
