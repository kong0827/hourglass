-- ============================================================================
-- 130_backfill_publication_list_column.sql · 已有列偏好补入「发布态」列（2026-11-27）
--
-- 背景：工作项列表新增「发布态」列并进入默认列集。默认列集只对新用户生效，
--       已有用户保存过显示字段，服务端只会按已保存的列回放，看不到新列。
-- 做法：只对 view_key='task-list' 且尚未包含 publication 的偏好追加该列；
--       插到 updatedAt 之前，与新的默认顺序一致；没有 updatedAt 时追加到末尾。
-- 幂等：已包含 publication 的行跳过；可重复执行。只改显示偏好，不动业务表结构。
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/130_backfill_publication_list_column.sql
-- ============================================================================

USE hourglass;

UPDATE `user_list_preference`
   SET `columns_json` = JSON_ARRAY_INSERT(
         `columns_json`,
         CONCAT('$[', COALESCE(
           CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(
             JSON_UNQUOTE(JSON_SEARCH(`columns_json`, 'one', 'updatedAt')), '[', -1), ']', 1) AS UNSIGNED),
           JSON_LENGTH(`columns_json`)
         ), ']'),
         'publication')
 WHERE `view_key` = 'task-list'
   AND JSON_VALID(`columns_json`)
   AND JSON_TYPE(`columns_json`) = 'ARRAY'
   AND JSON_CONTAINS(`columns_json`, '"publication"') = 0;
