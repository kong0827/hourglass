USE hourglass;

-- ============================================================================
-- 57_processing_rule.sql · 看板列增加「处理规则」（2026-11-09）
--
-- 规则说明：
--   normal  - 正常处理：可计时、计执行逾期
--   waiting - 等待接续：停表，但执行期限继续有效
--   ended   - 执行结束：停表、不计当前执行逾期，仍未交付
--
-- 待处理（backlog）与已完成（done）为系统固定列，不存储 processing_rule；
-- 其余列默认 normal，旧空间存量列不根据列名猜测规则。
-- ============================================================================

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'board_column'
                  AND COLUMN_NAME = 'processing_rule');
SET @sql := IF(@exists = 0,
  'ALTER TABLE board_column ADD COLUMN processing_rule VARCHAR(12) NOT NULL DEFAULT ''normal'' COMMENT ''处理规则：normal/waiting/ended''',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- 存量列统一置为 normal（不根据列名猜测规则），并约束取值
UPDATE board_column SET processing_rule = 'normal' WHERE processing_rule IS NULL OR processing_rule = '';
