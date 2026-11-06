-- ============================================================================
-- sql/baseline/01_schema_full.sql · 沙漏 Hourglass 完整基线 DDL（MySQL 8，utf8mb4）
--
-- 生成方式：在空库按序重放 sql/01-31 号升级脚本后导出（2026-11-04），与增量链等效。
-- 全新部署执行本文件即可，无需再跑 sql/ 目录；已有库的日常升级仍使用 sql/ 增量脚本。
-- 可重复执行（DROP TABLE IF EXISTS + CREATE TABLE）。
-- 执行（需 root 或具 CREATE USER / GRANT 权限的账号）：
--   mysql -uroot -p --default-character-set=utf8mb4 < sql/baseline/01_schema_full.sql
-- ============================================================================

-- 0. 建库 + 应用账号
CREATE DATABASE IF NOT EXISTS hourglass DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 应用账号：host '%' 允许外部连接，库内全部权限（增删改查、建表/改表/删表、视图、触发器、导入导出等）。
-- 上线前把占位密码换成强密码，并与 /etc/hourglass.env 的 DB_PASSWORD 保持一致；
-- 账号已存在时 CREATE USER IF NOT EXISTS 不会覆盖密码，改密码请用 ALTER USER。
-- 外部直连还需 MySQL 服务的 bind-address 非 127.0.0.1，且防火墙放行 3306。
CREATE USER IF NOT EXISTS 'hourglass'@'%' IDENTIFIED BY 'ChangeMe_Hourglass_2026!';
GRANT ALL PRIVILEGES ON hourglass.* TO 'hourglass'@'%';
FLUSH PRIVILEGES;

USE hourglass;

-- MySQL dump 10.13  Distrib 8.2.0, for Win64 (x86_64)
--
-- Host: localhost    Database: seed_yy_chk
-- ------------------------------------------------------
-- Server version	8.2.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `app_notification`
--

DROP TABLE IF EXISTS `app_notification`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_notification` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '通知ID',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '收件人用户ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源空间ID',
  `type` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '类型：task_remind/task_due/task_assigned/task_comment',
  `title` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题',
  `body` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '正文',
  `ref_task_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联任务ID（点击直达）',
  `read_at` datetime DEFAULT NULL COMMENT '已读时间，空=未读',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '产生时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_unread` (`user_id`,`read_at`,`id`),
  KEY `idx_user_ws` (`user_id`,`workspace_id`,`id`),
  KEY `idx_ws_ref` (`workspace_id`,`ref_task_id`),
  KEY `idx_user_ref_type` (`user_id`,`ref_task_id`,`type`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='应用内通知';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `app_user`
--

DROP TABLE IF EXISTS `app_user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_user` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户ID',
  `username` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录名',
  `password_hash` varchar(72) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'bcrypt 密码哈希',
  `display_name` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示名（负责人默认值）',
  `email` varchar(254) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '个人事件邮件收件地址',
  `role` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT '角色：admin/user（只管账号）',
  `session_version` bigint NOT NULL DEFAULT '1' COMMENT '账号级会话代次；密码/角色变更时递增，旧会话失效',
  `work_start_hour` tinyint NOT NULL DEFAULT '9' COMMENT '每天几点开始计入工时（0-23）',
  `work_end_hour` tinyint NOT NULL DEFAULT '18' COMMENT '每天几点之后不再计入（1-24，24=当天24:00）',
  `work_max_hours` tinyint NOT NULL DEFAULT '8' COMMENT '每人每天最多计入几小时（1-24）',
  `ai_provider` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'AI 厂商：deepseek/qwen/moonshot/zhipu/hunyuan/openai/ollama/custom',
  `ai_base_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API 基址（不含 /chat/completions）',
  `ai_model` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模型名，如 deepseek-chat',
  `ai_api_key` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'API Key（AES-GCM 加密，v1: 前缀）',
  `ai_enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否启用个人 AI（关闭时不发任何请求）',
  `last_workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '上次使用的空间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `attachment`
--

DROP TABLE IF EXISTS `attachment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `attachment` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '附件ID',
  `target_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属目标ID（任务/需求池需求）',
  `target_kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'task' COMMENT '目标类型：task任务/demand需求池需求',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `filename` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '原始文件名',
  `content_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'MIME 类型',
  `size` bigint NOT NULL DEFAULT '0' COMMENT '字节数',
  `stored_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '磁盘文件名',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
  PRIMARY KEY (`id`),
  KEY `idx_target` (`target_id`),
  KEY `idx_ws_target` (`workspace_id`,`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务附件';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `board_column`
--

DROP TABLE IF EXISTS `board_column`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `board_column` (
  `id` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '列ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `name` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '列名',
  `color` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '#8a8578' COMMENT '列颜色',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`workspace_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='看板列配置（每个空间一套）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `category`
--

DROP TABLE IF EXISTS `category`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `category` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分类ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `name` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分类名',
  `color` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '#8a8578' COMMENT '颜色',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_name` (`workspace_id`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分类（按空间）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `demand`
--

DROP TABLE IF EXISTS `demand`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `demand` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目ID（requirement 表）',
  `title` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求标题',
  `description` varchar(2000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '为什么做（背景与价值）',
  `source` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '来源（谁提的，如「财务 · 刘」）',
  `item_kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '新功能' COMMENT '类型：新功能/体验优化/缺陷/其他',
  `priority` varchar(4) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'P2' COMMENT '优先级 P0/P1/P2/P3',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'review' COMMENT '状态机：review待评审/pass已通过/plan已排期/rej已拒绝',
  `expect_date` date DEFAULT NULL COMMENT '期望交付时间',
  `accept_text` varchar(2000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '验收标准',
  `version_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目标版本（project_version，排期时选择）',
  `review_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '评审备注（通过理由/拒绝原因/排期说明）',
  `wsjf_business` tinyint unsigned DEFAULT NULL COMMENT 'WSJF·业务价值 0-10',
  `wsjf_urgency` tinyint unsigned DEFAULT NULL COMMENT 'WSJF·时间紧迫度 0-10',
  `wsjf_risk` tinyint unsigned DEFAULT NULL COMMENT 'WSJF·风险降低/机会 0-10',
  `wsjf_effort` tinyint unsigned DEFAULT NULL COMMENT 'WSJF·工作量 0-10（分母，需 ≥1）',
  `created_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '提交人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_ws_status` (`workspace_id`,`status`),
  KEY `idx_ws_req` (`workspace_id`,`req_id`),
  KEY `idx_version` (`version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求池（评审状态机）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `demand_doc_link`
--

DROP TABLE IF EXISTS `demand_doc_link`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `demand_doc_link` (
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `demand_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求池需求ID（demand.id）',
  `doc_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文档ID（requirement_doc.id）',
  `created_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '建立关联的账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关联时间',
  PRIMARY KEY (`workspace_id`,`demand_id`,`doc_id`),
  KEY `idx_ddl_doc` (`workspace_id`,`doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求池需求 ↔ 文档关联';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `demand_log`
--

DROP TABLE IF EXISTS `demand_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `demand_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `demand_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求ID',
  `action` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '动作：create/pass/rej/plan/reopen/update',
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注（拒绝原因/排期说明等）',
  `operator` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_ws_demand` (`workspace_id`,`demand_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求流转日志';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dev_branch`
--

DROP TABLE IF EXISTS `dev_branch`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dev_branch` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分支ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '所属项目ID（requirement.id），空=空间级公共分支',
  `req_key` varchar(32) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (ifnull(`req_id`,'')) STORED COMMENT '唯一性归一化：空间级分支用空串代替 NULL',
  `name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分支名（如 feature/login，允许 / . - _ 等字符）',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'dev' COMMENT '状态：dev=开发中 / testing=待测试 / merging=待合并 / released=已发布',
  `owner` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人显示名',
  `owner_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人账号ID',
  `target_branch` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目标分支（要合到哪，如 main / release/1.2）',
  `note` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `dev_at` datetime DEFAULT NULL COMMENT '进入「开发中」的时间',
  `test_at` datetime DEFAULT NULL COMMENT '进入「待测试」的时间',
  `merge_at` datetime DEFAULT NULL COMMENT '进入「待合并」的时间',
  `released_at` datetime DEFAULT NULL COMMENT '进入「已发布」的时间（发布周期 = released_at - created_at）',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '同状态内的排序',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_req_name` (`workspace_id`,`req_key`,`name`),
  KEY `idx_ws_status` (`workspace_id`,`status`),
  KEY `idx_ws_updated` (`workspace_id`,`updated_at`),
  KEY `idx_branch_req` (`workspace_id`,`req_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分支（空间级分支池，可归属项目）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `dev_branch_log`
--

DROP TABLE IF EXISTS `dev_branch_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dev_branch_log` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '日志ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `branch_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分支ID',
  `action` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '动作：create / status / update',
  `from_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '变更前状态（create 时为空）',
  `to_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '变更后状态',
  `detail` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '补充说明（状态备注 / 改了哪些字段）',
  `actor_name` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人显示名',
  `actor_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_branch` (`branch_id`,`created_at`),
  KEY `idx_ws` (`workspace_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分支状态变更记录（时间线）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `gantt_share`
--

DROP TABLE IF EXISTS `gantt_share`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gantt_share` (
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间',
  `token` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分享令牌（URL 参数）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `expires_at` datetime DEFAULT NULL COMMENT '过期时间（空=长期有效）',
  PRIMARY KEY (`workspace_id`),
  UNIQUE KEY `uk_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='甘特图只读分享';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `invite`
--

DROP TABLE IF EXISTS `invite`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invite` (
  `id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邀请码（10 位大写字母数字）',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `created_by` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '创建人用户ID',
  `expires_at` datetime NOT NULL COMMENT '过期时间',
  `used_count` int NOT NULL DEFAULT '0' COMMENT '已通过该链接加入的人数',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_ws` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间邀请链接';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mail_delivery`
--

DROP TABLE IF EXISTS `mail_delivery`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mail_delivery` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `recipient` varchar(254) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `body` text,
  `event_type` varchar(32) NOT NULL,
  `reference_id` varchar(32) DEFAULT NULL COMMENT '任务或需求 ID',
  `status` varchar(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/sent/failed',
  `attempts` int NOT NULL DEFAULT '0' COMMENT '已尝试次数，最多 3',
  `next_attempt_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_error` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sent_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_mail_delivery_due` (`status`,`next_attempt_at`,`id`),
  KEY `idx_mail_delivery_reference` (`event_type`,`reference_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='事件邮件持久化 outbox';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mail_setting`
--

DROP TABLE IF EXISTS `mail_setting`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mail_setting` (
  `id` tinyint NOT NULL DEFAULT '1' COMMENT '固定为 1，全局单行',
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `host` varchar(255) DEFAULT NULL,
  `port` int DEFAULT '587',
  `username` varchar(254) DEFAULT NULL,
  `password` varchar(512) DEFAULT NULL COMMENT 'AES-GCM 密文，v1: 前缀',
  `from_email` varchar(254) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_mail_setting_singleton` CHECK ((`id` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='全局 SMTP 配置';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_member`
--

DROP TABLE IF EXISTS `project_member`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_member` (
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `project_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '项目ID（requirement.id）',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '成员账号ID',
  `access` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '可见范围：none/read/pm/dev/qa',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`workspace_id`,`project_id`,`user_id`),
  KEY `idx_pm_user` (`workspace_id`,`user_id`),
  KEY `idx_pm_project` (`workspace_id`,`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目级成员可见范围';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `project_version`
--

DROP TABLE IF EXISTS `project_version`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_version` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '版本ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目ID',
  `name` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '版本名称',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '版本说明与发布摘要',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'planned' COMMENT 'planned/active/released',
  `start_date` date DEFAULT NULL COMMENT '计划开始日期',
  `target_date` date DEFAULT NULL COMMENT '计划发布日期',
  `released_at` datetime DEFAULT NULL COMMENT '实际发布时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_req_version_name` (`req_id`,`name`),
  KEY `idx_ws_req` (`workspace_id`,`req_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目版本';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `requirement`
--

DROP TABLE IF EXISTS `requirement`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `requirement` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '项目ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `name` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '项目名称',
  `description` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '项目描述',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '状态：active/done/hold',
  `first_released_at` date DEFAULT NULL COMMENT '首版上线日（空=未上线，全部投入归入首版开发）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_ws` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目（原需求）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `requirement_doc`
--

DROP TABLE IF EXISTS `requirement_doc`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `requirement_doc` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目ID（requirement.id）',
  `parent_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '父文档ID（同项目内层级，空=根文档）',
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '需求标题',
  `doc_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other' COMMENT '文档分类：requirement 需求文档 / technical 技术方案 / acceptance 测试验收 / other 其他',
  `content` mediumtext COLLATE utf8mb4_unicode_ci COMMENT '需求正文（清洗后的 HTML）',
  `format` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'html' COMMENT '正文格式：html 富文本 / markdown',
  `content_brief` varchar(400) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '纯文本摘要（列表用）',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT '状态：draft/active/done',
  `published_at` datetime DEFAULT NULL COMMENT '发布时间（空=草稿，仅作者与空间管理员可见）',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '同级排序（小的在前）',
  `owner` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人显示名',
  `owner_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_ws` (`workspace_id`),
  KEY `idx_req` (`req_id`),
  KEY `idx_ws_updated` (`workspace_id`,`updated_at`),
  KEY `idx_doc_parent` (`workspace_id`,`req_id`,`parent_id`),
  FULLTEXT KEY `ft_doc_fulltext` (`title`,`content_brief`,`content`) /*!50100 WITH PARSER `ngram` */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求（项目下的需求文档）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `requirement_doc_history`
--

DROP TABLE IF EXISTS `requirement_doc_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `requirement_doc_history` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '快照ID',
  `doc_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文档ID（requirement_doc.id）',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `version_no` int NOT NULL COMMENT '同一文档内从 1 递增的版本号',
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '快照时的文档标题',
  `content` mediumtext COLLATE utf8mb4_unicode_ci COMMENT '快照时的正文（与 requirement_doc.content 同口径）',
  `format` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'markdown' COMMENT '正文格式：html / markdown',
  `saved_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '保存人显示名',
  `saved_by_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '保存人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '快照时间',
  PRIMARY KEY (`id`),
  KEY `idx_history_doc` (`doc_id`,`version_no`),
  KEY `idx_history_ws` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档历史快照（查看与恢复旧版本）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `req_doc_comment`
--

DROP TABLE IF EXISTS `req_doc_comment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `req_doc_comment` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `doc_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文档ID（requirement_doc.id）',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论人账号ID',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论正文',
  `quote_text` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '引用的正文片段（批注上下文）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_doc_created` (`doc_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档评论';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `req_doc_share`
--

DROP TABLE IF EXISTS `req_doc_share`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `req_doc_share` (
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间',
  `doc_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文档ID（requirement_doc.id）',
  `token` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分享令牌（URL 参数）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `expires_at` datetime DEFAULT NULL COMMENT '过期时间（空=长期有效）',
  PRIMARY KEY (`workspace_id`,`doc_id`),
  UNIQUE KEY `uk_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求文档只读分享';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `saved_view`
--

DROP TABLE IF EXISTS `saved_view`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saved_view` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '视图ID',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属用户ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `name` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '视图名称',
  `params` varchar(600) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '筛选参数 JSON',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_ws` (`user_id`,`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='保存的筛选视图';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `subtask`
--

DROP TABLE IF EXISTS `subtask`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subtask` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '子任务ID',
  `task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属任务ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `title` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '子任务内容',
  `done` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否完成',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_task` (`task_id`,`id`),
  KEY `idx_ws_task` (`workspace_id`,`task_id`,`done`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='子任务（检查清单）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tag`
--

DROP TABLE IF EXISTS `tag`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tag` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标签ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `name` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标签名',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_name` (`workspace_id`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标签（按空间唯一）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task`
--

DROP TABLE IF EXISTS `task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务ID（沿用前端生成的字符串ID）',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `title` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题',
  `description` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '描述',
  `item_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'task' COMMENT '工作项类型：story用户故事/task任务/bug缺陷/epic史诗',
  `epic_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '所属史诗（Epic）任务ID（item_type=epic 时为空）',
  `demand_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联需求池需求ID（demand 表）',
  `severity` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '缺陷严重度：blocker阻断/critical严重/major一般/minor轻微',
  `environment` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '缺陷发现环境（浏览器/版本/设备等）',
  `reproduce_steps` text COLLATE utf8mb4_unicode_ci COMMENT '缺陷复现步骤',
  `found_version_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '缺陷发现版本ID（project_version）',
  `regression_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '回归状态：pending待回归/passed通过/failed不通过',
  `priority` varchar(4) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'P2' COMMENT '优先级 P0/P1/P2/P3',
  `owner` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '我' COMMENT '负责人（显示名文本，历史兼容）',
  `owner_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人账号ID（空=按显示名文本兼容）',
  `category` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '分类名（取值来自 category 表）',
  `board_column` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'backlog' COMMENT '看板列 id',
  `start_date` date DEFAULT NULL COMMENT '开始日期（空=只在截止日出现在日历上）',
  `due_date` date DEFAULT NULL COMMENT '截止日期',
  `gantt_start` date GENERATED ALWAYS AS (least(coalesce(`start_date`,`due_date`),coalesce(`due_date`,`start_date`))) STORED COMMENT '有效开始日（min(start,due)，甘特区间索引用）',
  `req_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '所属项目ID（requirement 表）',
  `req_doc_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联需求ID（requirement_doc）',
  `branch_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联分支ID（dev_branch）',
  `progress` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '进度 0-100',
  `is_milestone` tinyint(1) NOT NULL DEFAULT '0' COMMENT '里程碑（单日节点）',
  `estimate_minutes` int DEFAULT NULL COMMENT '预估耗时（分钟，空=没估过）',
  `is_blocked` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被阻塞（卡点）',
  `blocked_reason` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '卡点原因（卡在什么上/等谁）',
  `blocked_by_task_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '等待的任务ID（可选的依赖关系）',
  `note` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '进度备注',
  `completed_at` date DEFAULT NULL COMMENT '完成日期',
  `recur_type` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '循环：daily/weekly/monthly，空为不循环',
  `recur_next_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '循环派生的下一次任务ID（重复完成时复用，防重复生成）',
  `remind_at` datetime DEFAULT NULL COMMENT '任务级提醒时间',
  `remind_target` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'owner' COMMENT '提醒谁：owner / owner+admin',
  `remind_sent` tinyint(1) NOT NULL DEFAULT '0' COMMENT '提醒是否已推送',
  `deleted_at` datetime DEFAULT NULL COMMENT '软删除时间（回收站），空为正常',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '列内排序序号',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `gantt_end` date GENERATED ALWAYS AS (greatest(coalesce(`start_date`,`due_date`),coalesce(`due_date`,`start_date`))) STORED COMMENT '有效截止日（max(start,due)，甘特区间索引用）',
  PRIMARY KEY (`id`),
  KEY `idx_ws` (`workspace_id`),
  KEY `idx_board` (`workspace_id`,`board_column`,`sort_order`),
  KEY `idx_req` (`req_id`),
  KEY `idx_req_doc` (`req_doc_id`),
  KEY `idx_due` (`due_date`),
  KEY `idx_deleted` (`deleted_at`),
  KEY `idx_remind` (`remind_at`,`remind_sent`),
  KEY `idx_owner_user` (`owner_user_id`,`workspace_id`),
  KEY `idx_blocked` (`workspace_id`,`is_blocked`),
  KEY `idx_branch` (`branch_id`),
  KEY `idx_gantt_range` (`workspace_id`,`deleted_at`,`gantt_start`,`gantt_end`,`id`),
  KEY `idx_ws_due` (`workspace_id`,`due_date`),
  KEY `idx_ws_reqdoc_board` (`workspace_id`,`req_doc_id`,`board_column`),
  KEY `idx_ws_done_completed` (`workspace_id`,`board_column`,`completed_at`),
  KEY `idx_ws_updated` (`workspace_id`,`updated_at`),
  KEY `idx_ws_created_at` (`workspace_id`,`created_at`),
  KEY `idx_ws_estimate` (`workspace_id`,`estimate_minutes`),
  KEY `idx_ws_req` (`workspace_id`,`req_id`),
  KEY `idx_remind_scan` (`remind_sent`,`remind_at`),
  KEY `idx_ws_type` (`workspace_id`,`item_type`),
  KEY `idx_epic` (`epic_id`),
  KEY `idx_demand` (`demand_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task_baseline`
--

DROP TABLE IF EXISTS `task_baseline`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_baseline` (
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间',
  `task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务ID',
  `start_date` date DEFAULT NULL COMMENT '基线开始日期',
  `due_date` date DEFAULT NULL COMMENT '基线截止日期',
  `captured_at` datetime NOT NULL COMMENT '快照时间',
  PRIMARY KEY (`workspace_id`,`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='甘特图基线快照';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task_comment`
--

DROP TABLE IF EXISTS `task_comment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_comment` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '评论ID',
  `task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属任务ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `author_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '作者用户ID',
  `author_name` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '作者显示名快照',
  `content` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论正文',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发表时间',
  PRIMARY KEY (`id`),
  KEY `idx_task` (`task_id`,`id`),
  KEY `idx_ws` (`workspace_id`,`id`),
  KEY `idx_ws_task` (`workspace_id`,`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务评论';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task_completion_record`
--

DROP TABLE IF EXISTS `task_completion_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_completion_record` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务ID（任务删除后仍保留）',
  `title` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务名称（完成时快照）',
  `description` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '任务详情（完成时快照）',
  `req_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '归属项目ID',
  `req_name` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '归属项目名称（冗余，防改名失真）',
  `req_doc_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联需求ID（requirement_doc）',
  `req_doc_title` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '需求名称（完成时快照）',
  `owner` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人（完成时快照）',
  `owner_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人账号ID',
  `category` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '分类',
  `priority` varchar(3) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '优先级 P0-P3',
  `start_date` date DEFAULT NULL COMMENT '任务开始日期',
  `completed_at` date NOT NULL COMMENT '完成日期',
  `first_started_at` datetime DEFAULT NULL COMMENT '首次计时开始时间',
  `last_ended_at` datetime DEFAULT NULL COMMENT '最后一次计时结束时间',
  `total_minutes` int NOT NULL DEFAULT '0' COMMENT '总耗时（分钟，每天 8h / 跳过周末）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '归档时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_task` (`workspace_id`,`task_id`),
  KEY `idx_ws_completed` (`workspace_id`,`completed_at`)
) ENGINE=InnoDB AUTO_INCREMENT=712 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务完成快照（月度统计用）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task_dependency`
--

DROP TABLE IF EXISTS `task_dependency`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_dependency` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '依赖ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间',
  `from_task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '前驱任务（先做）',
  `to_task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '后继任务（后做）',
  `dep_type` varchar(2) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'FS' COMMENT 'FS/SS/FF/SF',
  `lag_days` int NOT NULL DEFAULT '0' COMMENT '滞后天数（可为负）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_edge` (`from_task_id`,`to_task_id`),
  KEY `idx_ws` (`workspace_id`),
  KEY `idx_to` (`to_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务依赖（甘特图）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task_log`
--

DROP TABLE IF EXISTS `task_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '日志ID',
  `task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `actor_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人用户ID（历史数据可空）',
  `action` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '动作：create/update/move/delete/restore/undo',
  `detail` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '变更摘要',
  `from_column` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '移动前所在看板列 id（仅 action=move 且跨列时非空）',
  `to_column` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '移动后所在看板列 id（仅 action=move 且跨列时非空）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间',
  PRIMARY KEY (`id`),
  KEY `idx_task` (`task_id`,`id`),
  KEY `idx_ws` (`workspace_id`,`id`),
  KEY `idx_ws_action_time` (`workspace_id`,`action`,`created_at`),
  KEY `idx_ws_created` (`workspace_id`,`created_at`),
  KEY `idx_ws_task_created` (`workspace_id`,`task_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务操作日志（时间线）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task_tag`
--

DROP TABLE IF EXISTS `task_tag`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_tag` (
  `task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务ID',
  `tag_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标签ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  PRIMARY KEY (`task_id`,`tag_id`),
  KEY `idx_tag` (`tag_id`),
  KEY `idx_ws_task` (`workspace_id`,`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务-标签关联';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task_watch`
--

DROP TABLE IF EXISTS `task_watch`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_watch` (
  `task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关注人用户ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关注时间',
  PRIMARY KEY (`task_id`,`user_id`),
  KEY `idx_watch_user` (`user_id`,`workspace_id`),
  KEY `idx_watch_ws_task` (`workspace_id`,`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务关注人';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `test_case`
--

DROP TABLE IF EXISTS `test_case`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `req_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属项目ID（requirement.id）',
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例标题',
  `precondition` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '前置条件',
  `steps` mediumtext COLLATE utf8mb4_unicode_ci COMMENT '执行步骤 JSON：[{"action":"操作","expected":"预期结果"}]',
  `latest_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近执行结果：passed/failed/blocked，空=未执行',
  `latest_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近执行备注',
  `latest_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近执行人显示名',
  `latest_by_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近执行人账号ID',
  `latest_at` datetime DEFAULT NULL COMMENT '最近执行时间',
  `latest_bug_task_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近失败转出的缺陷任务ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_ws_req` (`workspace_id`,`req_id`),
  KEY `idx_bug` (`latest_bug_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='测试用例（项目下，展示最近一轮执行结果）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `test_case_run`
--

DROP TABLE IF EXISTS `test_case_run`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `test_case_run` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '执行记录ID',
  `case_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用例ID（test_case.id）',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '执行结果：passed/failed/blocked',
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '执行备注（失败原因等）',
  `bug_task_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '由本次失败转出的缺陷任务ID',
  `executed_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '执行人显示名',
  `executed_by_user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '执行人账号ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '执行时间',
  PRIMARY KEY (`id`),
  KEY `idx_case` (`case_id`,`id`),
  KEY `idx_ws` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用例执行流水（每次执行一行）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `time_log`
--

DROP TABLE IF EXISTS `time_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `time_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '计时人（个人计时）',
  `started_at` datetime NOT NULL COMMENT '开始时间',
  `ended_at` datetime DEFAULT NULL COMMENT '结束时间',
  `minutes` int DEFAULT NULL COMMENT '时长（分钟）',
  `origin` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'timer' COMMENT '记录来源：timer=计时器，manual=手工补记',
  `note` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '手工补记备注',
  PRIMARY KEY (`id`),
  KEY `idx_task` (`task_id`,`ended_at`),
  KEY `idx_ws` (`workspace_id`,`ended_at`),
  KEY `idx_user_timer` (`user_id`,`ended_at`),
  KEY `idx_ws_started` (`workspace_id`,`started_at`),
  KEY `idx_user_started` (`user_id`,`started_at`),
  KEY `idx_ws_task_started` (`workspace_id`,`task_id`,`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工时记录';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_list_preference`
--

DROP TABLE IF EXISTS `user_list_preference`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_list_preference` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间ID',
  `view_key` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '视图：task-list/project-list',
  `view_mode` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '视图模式：table/card',
  `columns_json` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示列紧凑JSON数组',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`user_id`,`workspace_id`,`view_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户列表视图与显示列偏好';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_notification_preference`
--

DROP TABLE IF EXISTS `user_notification_preference`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_notification_preference` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'task_assigned/task_updated/task_comment/demand_status',
  `in_app_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `email_enabled` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`user_id`,`event_type`),
  CONSTRAINT `fk_unp_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='个人事件通知偏好';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `version_task`
--

DROP TABLE IF EXISTS `version_task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `version_task` (
  `task_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务ID，一个任务最多归属一个版本',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `version_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '版本ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '关联时间',
  PRIMARY KEY (`task_id`),
  KEY `idx_version` (`version_id`),
  KEY `idx_workspace` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='版本任务关联';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `work_activity`
--

DROP TABLE IF EXISTS `work_activity`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `work_activity` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `entity_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '实体类型：project/requirement_doc',
  `entity_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '实体ID',
  `actor_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人用户ID',
  `actor_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人显示名快照',
  `action` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'create/update/first_release',
  `detail` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '变更摘要（正文不保存HTML）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_ws_entity_id` (`workspace_id`,`entity_type`,`entity_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务实体活动轨迹';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `workspace`
--

DROP TABLE IF EXISTS `workspace`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `workspace` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间ID（个人空间为 W+用户ID）',
  `name` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间名称',
  `type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'shared' COMMENT 'personal/shared',
  `notify_webhook` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '空间推送 webhook（群机器人）',
  `notify_channel` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'webhook/serverchan/pushplus，空=跟随全局 NOTIFY_TYPE',
  `notify_enabled` tinyint(1) DEFAULT NULL COMMENT '空间推送开关：NULL=跟随全局，1=开，0=关',
  `notify_in_app_enabled` tinyint(1) DEFAULT NULL,
  `notify_token` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Server酱 SendKey / PushPlus token（空=用全局）',
  `notify_last_at` datetime DEFAULT NULL COMMENT '上次推送尝试时间',
  `notify_last_status` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'success / failed:原因',
  `owner_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间主用户ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_owner` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `workspace_member`
--

DROP TABLE IF EXISTS `workspace_member`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `workspace_member` (
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '空间ID',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '成员用户ID',
  `role` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'member' COMMENT '空间角色：owner/admin/member/viewer',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
  PRIMARY KEY (`workspace_id`,`user_id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='空间成员';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `workspace_priority`
--

DROP TABLE IF EXISTS `workspace_priority`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `workspace_priority` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置ID',
  `workspace_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归属空间ID',
  `code` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '固定档位：P0/P1/P2/P3',
  `name` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示名',
  `color` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '显示颜色 #RRGGBB',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ws_code` (`workspace_id`,`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='优先级显示配置（按空间，未配置档位用内置默认）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-04 10:53:29
