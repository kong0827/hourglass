-- ============================================================================
-- 110_task_comment_content_length.sql · 工作项评论正文放宽到 2000 字（2026-11-18）
--
-- 背景：评论原上限 500 字，贴一段错误日志或会议结论就会超限；
--       需求池评论（demand_comment）已是 TEXT，这里只把工作项评论对齐到可用长度。
-- 范围：仅修改 task_comment.content 的长度；不新增字段、不改表结构语义、不回填数据。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/110_task_comment_content_length.sql
-- 可重复执行：当前长度已不小于 2000 时跳过。
-- ============================================================================

USE hourglass;

DROP PROCEDURE IF EXISTS hg_task_comment_content_len;
DELIMITER $$
CREATE PROCEDURE hg_task_comment_content_len()
BEGIN
  DECLARE current_len BIGINT DEFAULT NULL;
  SELECT CHARACTER_MAXIMUM_LENGTH INTO current_len
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'task_comment'
     AND column_name = 'content';
  IF current_len IS NOT NULL AND current_len < 2000 THEN
    ALTER TABLE `task_comment`
      MODIFY `content` VARCHAR(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        NOT NULL COMMENT '评论正文';
  END IF;
END$$
DELIMITER ;

CALL hg_task_comment_content_len();
DROP PROCEDURE hg_task_comment_content_len;
