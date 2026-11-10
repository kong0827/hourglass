USE hourglass;

-- 测试流程与测试时间：工作项增加「待测试 / 测试中」两个内置列，并在任务上记录测试窗口。
-- 只做结构补齐和标准列补齐，不回填历史测试时间：旧数据没有可靠记录时不伪造时间。

DROP PROCEDURE IF EXISTS hg_test_flow_column;
DELIMITER $$
CREATE PROCEDURE hg_test_flow_column(IN table_name_value VARCHAR(64), IN column_name_value VARCHAR(64), IN definition_value TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = table_name_value AND column_name = column_name_value) THEN
    SET @test_flow_ddl = CONCAT('ALTER TABLE `', table_name_value, '` ADD COLUMN `', column_name_value, '` ', definition_value);
    PREPARE test_flow_stmt FROM @test_flow_ddl;
    EXECUTE test_flow_stmt;
    DEALLOCATE PREPARE test_flow_stmt;
  END IF;
END$$
DELIMITER ;

CALL hg_test_flow_column('task', 'test_started_at', 'DATE NULL COMMENT ''进入测试中的日期（新一轮测试重新记录）''');
CALL hg_test_flow_column('task', 'test_finished_at', 'DATE NULL COMMENT ''离开测试中的日期：测试通过或退回''');
DROP PROCEDURE hg_test_flow_column;

-- 每个空间补齐标准测试列；已存在同 id 的列不重复插入。
-- 新列插在「进行中」之后，先把同位置的既有自定义列顺延，避免排序号冲突打乱现有看板。
UPDATE board_column bc
JOIN workspace w ON w.id = bc.workspace_id
LEFT JOIN (SELECT DISTINCT workspace_id FROM board_column WHERE id = 'test') has_test
       ON has_test.workspace_id = w.id
SET bc.sort_order = bc.sort_order + 2
WHERE has_test.workspace_id IS NULL AND bc.sort_order >= 2;

UPDATE board_column bc
JOIN workspace w ON w.id = bc.workspace_id
LEFT JOIN (SELECT DISTINCT workspace_id FROM board_column WHERE id = 'testing') has_testing
       ON has_testing.workspace_id = w.id
SET bc.sort_order = bc.sort_order + 1
WHERE has_testing.workspace_id IS NULL AND bc.sort_order >= 3;

INSERT INTO board_column (id, workspace_id, name, color, processing_rule, sort_order)
SELECT 'test', w.id, '待测试', '#8b6fb5', 'waiting', 2
FROM workspace w
WHERE NOT EXISTS (SELECT 1 FROM board_column bc
                  WHERE bc.workspace_id = w.id AND bc.id = 'test');

INSERT INTO board_column (id, workspace_id, name, color, processing_rule, sort_order)
SELECT 'testing', w.id, '测试中', '#b06f9a', 'normal', 3
FROM workspace w
WHERE NOT EXISTS (SELECT 1 FROM board_column bc
                  WHERE bc.workspace_id = w.id AND bc.id = 'testing');
