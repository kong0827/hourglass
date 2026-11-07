-- ============================================================================
-- 工作台 · 每个账号自己的 AI 配置（2026-10-23）
--
-- 为什么放在 app_user 而不是 workspace：AI 额度是按账号买的，
-- 同一个人在不同空间用的是同一把 key；换空间不该让他重新填一次。
--
-- 安全：api_key 以 AES-GCM 加密后存库（带 `v1:` 前缀），密钥来自
--       app.ai.crypto-key（部署时用环境变量 AI_CRYPTO_KEY 覆盖）。
--       接口只返回掩码，永不回传明文。密钥丢了不影响系统，用户重填一次即可。
--
-- 设计原则：纯增量、幂等、向后兼容（照 sql/10 的写法）。
-- 执行：mysql -u hourglass -p hourglass < sql/12_ai_config.sql
-- ============================================================================

USE hourglass;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'ai_provider');
SET @s := IF(@x = 0,
  'ALTER TABLE app_user ADD COLUMN ai_provider VARCHAR(24) DEFAULT NULL
     COMMENT ''AI 厂商：deepseek/qwen/moonshot/zhipu/hunyuan/openai/ollama/custom'' AFTER work_max_hours',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'ai_base_url');
SET @s := IF(@x = 0,
  'ALTER TABLE app_user ADD COLUMN ai_base_url VARCHAR(255) DEFAULT NULL
     COMMENT ''API 基址（不含 /chat/completions）'' AFTER ai_provider',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'ai_model');
SET @s := IF(@x = 0,
  'ALTER TABLE app_user ADD COLUMN ai_model VARCHAR(64) DEFAULT NULL
     COMMENT ''模型名，如 deepseek-chat'' AFTER ai_base_url',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'ai_api_key');
SET @s := IF(@x = 0,
  'ALTER TABLE app_user ADD COLUMN ai_api_key VARCHAR(512) DEFAULT NULL
     COMMENT ''API Key（AES-GCM 加密，v1: 前缀）'' AFTER ai_model',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @x := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user' AND COLUMN_NAME = 'ai_enabled');
SET @s := IF(@x = 0,
  'ALTER TABLE app_user ADD COLUMN ai_enabled TINYINT(1) NOT NULL DEFAULT 0
     COMMENT ''是否启用个人 AI（关闭时不发任何请求）'' AFTER ai_api_key',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 自检：只输出字段，不输出 key 值
-- ---------------------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
  AND COLUMN_NAME IN ('ai_provider', 'ai_base_url', 'ai_model', 'ai_api_key', 'ai_enabled')
ORDER BY ORDINAL_POSITION;
