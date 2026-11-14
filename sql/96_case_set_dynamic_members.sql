-- ============================================================================
-- 96_case_set_dynamic_members.sql · 动态分组（规则自动收录）+ 指定成员可见
--
-- 背景：批次 A 的用例集只有手工挑选与 team/personal 两档可见范围。本脚本补两件事：
--   1) 动态分组：case_set.kind=dynamic 时成员由 rule_json 派生，服务层在读取时自愈刷新
--      case_set_item（新用例命中条件自动进入，不再命中自动移出），因此列表 / 计数 /
--      「未加入任何分组」/ 计划圈选全部沿用既有成员引用口径，不需要第二套查询。
--      rule_json 只存白名单字段：status/pri/moduleId/moduleSub/demandId/owner/bugOnly/
--      q/searchWide/regression；regression=true 表示回归集谓词（最近失败/阻塞 或 关联未关闭缺陷）。
--   2) 指定成员可见：visibility=members + case_set_member 名单；名单内成员可见可用，
--      管理权仍归创建人。团队共享分组进发布检查与交付说明证据，members/personal 不进。
--
-- 回填：无。存量分组 kind 默认 manual、rule_json 留空，行为与升级前完全一致。
--
-- 执行：mysql -uroot -p --default-character-set=utf8mb4 < sql/96_case_set_dynamic_members.sql
-- ============================================================================

USE hourglass;

-- 1. 动态分组：kind + 规则 JSON
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `case_set`
     ADD COLUMN `kind` varchar(8) NOT NULL DEFAULT ''manual'' COMMENT ''manual=手工挑选 / dynamic=按规则自动收录'' AFTER `visibility`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'case_set' AND column_name = 'kind');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `case_set`
     ADD COLUMN `rule_json` varchar(2000) DEFAULT NULL COMMENT ''动态分组收录规则（白名单字段 JSON），manual 为 NULL'' AFTER `kind`',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'case_set' AND column_name = 'rule_json');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. 可见范围补 members 档（只改注释，类型与约束不变）
SET @s := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `case_set`
     MODIFY COLUMN `visibility` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''team'' COMMENT ''team=团队共享（进证据）/members=指定成员可见（不进证据）/personal=仅自己可见（不进证据）''',
  'DO 0') FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'case_set' AND column_name = 'visibility'
    AND column_comment NOT LIKE '%members%');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3. 指定成员名单：成员是引用不是复制，删分组 / 删成员都只解除引用
CREATE TABLE IF NOT EXISTS `case_set_member` (
  `set_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例集ID（case_set.id）',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '可见成员账号ID（workspace_member.user_id）',
  `workspace_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入名单时间',
  PRIMARY KEY (`set_id`,`user_id`),
  KEY `idx_ws_user` (`workspace_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例集指定可见成员（visibility=members 时生效）';