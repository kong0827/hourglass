-- ============================================================================
-- 95_ai_shared_setting.sql · 团队共享 AI 配置（2026-11-14）
--
-- 背景：AI 配置原来只属于账号（sql/12 给 app_user 加了 ai_*）。公司统一采购
-- API 之后，需要平台管理员配一次、全员使用；个人 Key 仍保留，可选择继续使用。
--
-- 本脚本做两件事：
--   1) 新建 ai_shared_setting：一行一个作用域。P0 只用 scope='platform'
--      （scope_id 固定 '0'），预留 scope='workspace' 供后续空间级覆盖。
--   2) app_user 增 ai_prefer：NULL/auto=团队优先，personal=只用个人 Key。
--
-- 存量保护：已有「个人 Key（或本地 Ollama）且已启用」的账号初始化为 personal，
-- 避免团队配置一上线就静默把这类用户切到公司厂商和公司账单。该回填只在
-- ai_prefer 列本次新增时执行一次，脚本重跑不会把后来选择 auto 的用户改回 personal。
--
-- 安全：api_key 以 AES-GCM 加密（v1: 前缀），与个人 Key 同一把部署密钥；
--       接口只回掩码，审计只记改动项，不落明文或密文。
--
-- 设计原则：纯增量、幂等、可重复执行。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/95_ai_shared_setting.sql
-- ============================================================================

USE hourglass;

-- 1. 共享配置表：平台单行用 scope='platform' + scope_id='0'
CREATE TABLE IF NOT EXISTS `ai_shared_setting` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `scope` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'platform / workspace',
  `scope_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0' COMMENT 'platform 固定为 0；workspace 存空间 ID',
  `provider` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'AI 厂商；空=未配置',
  `base_url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API 基址（不含 /chat/completions）',
  `model` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模型名',
  `api_key` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API Key（AES-GCM 加密，v1: 前缀）',
  `enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否启用该作用域的共享 AI',
  `allow_personal` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否允许成员改用个人 Key（仅 platform 行生效）',
  `updated_by` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近修改人显示名',
  `updated_at` datetime DEFAULT NULL COMMENT '最近修改时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_shared_scope` (`scope`,`scope_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队 / 空间共享 AI 配置（密钥加密存储）';

-- 2. 账号表增来源偏好；@column_added 供第 3 步只在本次新增时回填
SET @column_added := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
                        AND COLUMN_NAME = 'ai_prefer');

SET @s := IF(@column_added,
  'ALTER TABLE app_user ADD COLUMN ai_prefer VARCHAR(16) DEFAULT NULL
     COMMENT ''AI 来源偏好：NULL/auto=团队优先，personal=只用个人 Key'' AFTER ai_enabled',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3. 一次性回填：保留存量用户真实选择，避免团队配置上线后静默改用公司 Key
UPDATE app_user
SET ai_prefer = 'personal'
WHERE @column_added
  AND ai_prefer IS NULL
  AND ai_enabled = 1
  AND ((ai_api_key IS NOT NULL AND ai_api_key <> '') OR ai_provider = 'ollama');

-- ---------------------------------------------------------------------------
-- 自检：应看到新表、ai_prefer 列；不输出任何 Key 值
-- ---------------------------------------------------------------------------
SELECT COUNT(*) AS ai_shared_setting_exists
FROM information_schema.tables
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_shared_setting';

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_user'
  AND COLUMN_NAME = 'ai_prefer';
