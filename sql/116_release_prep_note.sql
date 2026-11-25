-- ============================================================================
-- 116_release_prep_note.sql · 发布准备推送补充说明（2026-11-21）
--
-- 背景：
--   发布准备推送的标题与正文由服务端模板生成，发送人无法补充「本次涉及数据库
--   迁移」「请提前冻结分支」这类一次性上下文，只能线下再通知一遍。
--
-- 口径：
--   每次「通知成员」可带一段选填补充说明，最多 200 字；说明与固定事实句
--   （计划名、发布时间、深链）一起进入站内、邮件、企业微信群，不替换模板。
--   保存在推送批次上，用于去重比较与推送记录追溯；自动通知（改期、里程碑）
--   不带补充说明。
--
-- 边界：
--   只加一个可空列，不回填历史批次，不改变模板与渠道。
--
-- 执行：mysql -u hourglass -p --default-character-set=utf8mb4 hourglass < sql/116_release_prep_note.sql
-- 可重复执行；只增列，不回填。
-- ============================================================================

USE hourglass;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `version_release_plan_push` ADD COLUMN `note` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''发送时的补充说明（选填，最多200字）'' AFTER `channels`',
  'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'version_release_plan_push' AND COLUMN_NAME = 'note');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
