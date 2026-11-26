-- ============================================================================
-- 126_release_artifact_digest_optional.sql · 发布记录制品 SHA256 改为选填（2026-11-26）
--
-- 背景：只有接入了 CI / 制品库的团队才能稳定拿到 64 位制品哈希；没有流水线时
--       人工每次计算成本高，且容易把 40 位 commit id 误填进来被拒。
--       因此把 artifact_digest 改为可空：留空表示「未记录校验值」，
--       填写时后端仍强制 64 位十六进制，口径不变。
-- 范围：仅放宽 version_release.artifact_digest 的 NOT NULL；不改字段长度、
--       不回填、不改历史记录值，也不改变发布判重与回滚的产物比较语义。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/126_release_artifact_digest_optional.sql
-- 可重复执行：当前列已允许 NULL 时跳过。
-- ============================================================================

USE hourglass;

DROP PROCEDURE IF EXISTS hg_release_artifact_digest_optional;
DELIMITER $$
CREATE PROCEDURE hg_release_artifact_digest_optional()
BEGIN
  DECLARE nullable_flag VARCHAR(3) DEFAULT NULL;
  SELECT IS_NULLABLE INTO nullable_flag
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'version_release'
     AND column_name = 'artifact_digest';
  IF nullable_flag = 'NO' THEN
    ALTER TABLE `version_release`
      MODIFY `artifact_digest` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;
  END IF;
END$$
DELIMITER ;

CALL hg_release_artifact_digest_optional();
DROP PROCEDURE hg_release_artifact_digest_optional;
