-- ============================================================================
-- 用户邮箱、个人事件通知偏好、SMTP 与持久化邮件 outbox
-- 执行：mysql -u devstudio -p devstudio < sql/26_email_notification.sql
-- 幂等：email 列先检查 information_schema；三张新表使用 IF NOT EXISTS。
-- ============================================================================

USE devstudio;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'email');
SET @s := IF(@x = 0,
  'ALTER TABLE app_user ADD COLUMN email VARCHAR(254) DEFAULT NULL
     COMMENT ''个人事件邮件收件地址'' AFTER display_name',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS user_notification_preference (
  user_id VARCHAR(32) NOT NULL,
  event_type VARCHAR(32) NOT NULL COMMENT 'task_assigned/task_updated/task_comment/demand_status',
  in_app_enabled TINYINT(1) NOT NULL DEFAULT 1,
  email_enabled TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, event_type),
  CONSTRAINT fk_unp_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人事件通知偏好';

CREATE TABLE IF NOT EXISTS mail_setting (
  id TINYINT NOT NULL DEFAULT 1 COMMENT '固定为 1，全局单行',
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  host VARCHAR(255) DEFAULT NULL,
  port INT DEFAULT 587,
  username VARCHAR(254) DEFAULT NULL,
  password VARCHAR(512) DEFAULT NULL COMMENT 'AES-GCM 密文，v1: 前缀',
  from_email VARCHAR(254) DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_mail_setting_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='全局 SMTP 配置';

CREATE TABLE IF NOT EXISTS mail_delivery (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient VARCHAR(254) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT,
  event_type VARCHAR(32) NOT NULL,
  reference_id VARCHAR(32) DEFAULT NULL COMMENT '任务或需求 ID',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/sent/failed',
  attempts INT NOT NULL DEFAULT 0 COMMENT '已尝试次数，最多 3',
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error VARCHAR(1000) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_mail_delivery_due (status, next_attempt_at, id),
  INDEX idx_mail_delivery_reference (event_type, reference_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='事件邮件持久化 outbox';

-- 自检：不应输出 SMTP 密码内容。
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'email';
