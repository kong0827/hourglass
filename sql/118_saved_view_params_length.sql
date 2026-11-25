-- ============================================================================
-- 118_saved_view_params_length.sql · 保存视图参数列放宽（2026-11-21）
--
-- 全局搜索支持保存为视图（scope=search），参数里会多出 reqId / versionId /
-- type / status / owner / from / to。原 varchar(600) 在筛选维度较多的任务视图上
-- 已接近上限，这里统一放宽到 varchar(2000)，与 SavedViewService 的 1900 字符
-- 业务校验保持一致。
--
-- 执行：mysql -u hourglass -p --default-character-set=utf8mb4 hourglass < sql/118_saved_view_params_length.sql
-- 可重复执行；只扩列宽，不改数据。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) > 0,
  'ALTER TABLE `saved_view` MODIFY COLUMN `params` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT ''筛选参数 JSON''',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saved_view' AND COLUMN_NAME = 'params'
    AND CHARACTER_MAXIMUM_LENGTH < 2000);
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
