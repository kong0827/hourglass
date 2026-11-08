package com.hourglass.service;

import com.hourglass.common.CurrentUser;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.AuditLogMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.io.File;
import java.lang.management.ManagementFactory;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 系统信息（只读，平台管理员）：版本/运行时/数据库/附件容量/邮件与推送状态/SSE 连接数 */
@Service
public class SystemInfoService {

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final JdbcTemplate jdbc;
    private final SseService sse;
    private final MailSettingService mailSettings;
    private final WorkspaceService workspaceService;
    private final AuditLogMapper auditLogMapper;

    @Value("${app.version:1.0.0}")
    private String appVersion;

    @Value("${app.attach.dir:./data/attachments}")
    private String attachDir;

    public SystemInfoService(JdbcTemplate jdbc, SseService sse, MailSettingService mailSettings,
                             WorkspaceService workspaceService, AuditLogMapper auditLogMapper) {
        this.jdbc = jdbc;
        this.sse = sse;
        this.mailSettings = mailSettings;
        this.workspaceService = workspaceService;
        this.auditLogMapper = auditLogMapper;
    }

    public Map<String, Object> info(String workspaceParam) {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        LocalDateTime now = LocalDateTime.now();
        long uptimeMs = ManagementFactory.getRuntimeMXBean().getUptime();

        Map<String, Object> app = new LinkedHashMap<String, Object>();
        app.put("name", "hourglass-server");
        app.put("version", appVersion);
        app.put("now", now.format(TS));
        app.put("startedAt", now.minusSeconds(uptimeMs / 1000).format(TS));
        app.put("uptimeSeconds", uptimeMs / 1000);
        data.put("app", app);

        Map<String, Object> runtime = new LinkedHashMap<String, Object>();
        runtime.put("javaVersion", System.getProperty("java.version"));
        runtime.put("javaVendor", System.getProperty("java.vendor"));
        runtime.put("osName", System.getProperty("os.name"));
        runtime.put("osArch", System.getProperty("os.arch"));
        runtime.put("processors", Runtime.getRuntime().availableProcessors());
        runtime.put("maxMemoryBytes", Runtime.getRuntime().maxMemory());
        runtime.put("usedMemoryBytes", Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory());
        data.put("runtime", runtime);

        Map<String, Object> db = new LinkedHashMap<String, Object>();
        try {
            db.put("status", "up");
            db.put("version", jdbc.queryForObject("SELECT VERSION()", String.class));
        } catch (Exception e) {
            db.put("status", "down");
        }
        data.put("database", db);

        Map<String, Object> storage = new LinkedHashMap<String, Object>();
        storage.put("path", attachDir);
        try {
            Map<String, Object> row = jdbc.queryForMap(
                    "SELECT COUNT(*) AS cnt, COALESCE(SUM(size), 0) AS bytes FROM attachment");
            storage.put("fileCount", ((Number) row.get("cnt")).longValue());
            storage.put("totalBytes", ((Number) row.get("bytes")).longValue());
        } catch (Exception e) {
            storage.put("fileCount", 0L);
            storage.put("totalBytes", 0L);
        }
        try {
            File dir = new File(attachDir);
            storage.put("diskTotalBytes", dir.getTotalSpace());
            storage.put("diskUsableBytes", dir.getUsableSpace());
        } catch (Exception ignored) {
            // 目录不可读时只展示已记录用量
        }
        data.put("storage", storage);

        data.put("mail", mailInfo());
        data.put("webhook", webhookInfo(workspaceParam));
        data.put("sse", sseInfo());
        data.put("backup", backupInfo());
        data.put("audit", auditInfo());
        return data;
    }

    private Map<String, Object> mailInfo() {
        Map<String, Object> mail = new LinkedHashMap<String, Object>();
        boolean enabled = false;
        try {
            enabled = mailSettings.get() != null && Boolean.TRUE.equals(mailSettings.get().getEnabled());
        } catch (Exception ignored) {
            // 配置读取失败按未启用展示
        }
        mail.put("enabled", enabled);
        long pending = 0, sent = 0, failed = 0;
        try {
            List<Map<String, Object>> rows = jdbc.queryForList(
                    "SELECT status, COUNT(*) AS c FROM mail_delivery GROUP BY status");
            for (Map<String, Object> row : rows) {
                String status = String.valueOf(row.get("status"));
                long c = ((Number) row.get("c")).longValue();
                if ("pending".equals(status)) {
                    pending = c;
                } else if ("sent".equals(status)) {
                    sent = c;
                } else if ("failed".equals(status)) {
                    failed = c;
                }
            }
        } catch (Exception ignored) {
            // 表不存在时保持 0
        }
        mail.put("pending", pending);
        mail.put("sent", sent);
        mail.put("failed", failed);
        try {
            Map<String, Object> last = jdbc.queryForMap(
                    "SELECT status, created_at, sent_at, last_error FROM mail_delivery ORDER BY id DESC LIMIT 1");
            mail.put("lastStatus", last.get("status"));
            mail.put("lastAt", ts(last.get("created_at")));
            mail.put("lastSentAt", ts(last.get("sent_at")));
            mail.put("lastError", sanitize((String) last.get("last_error"), 160));
        } catch (Exception ignored) {
            // 没有邮件记录
        }
        return mail;
    }

    private Map<String, Object> webhookInfo(String workspaceParam) {
        Map<String, Object> hook = new LinkedHashMap<String, Object>();
        try {
            Workspace ws = workspaceService.resolve(CurrentUser.id(), workspaceParam);
            hook.put("workspaceId", ws.getId());
            hook.put("workspaceName", ws.getName());
            boolean configured = notBlank(ws.getNotifyWebhook()) || notBlank(ws.getNotifyToken());
            hook.put("configured", configured);
            hook.put("channel", ws.getNotifyChannel() == null ? "跟随全局" : ws.getNotifyChannel());
            hook.put("enabled", ws.getNotifyEnabled());
            hook.put("inAppEnabled", ws.getNotifyInAppEnabled());
            hook.put("lastAt", ws.getNotifyLastAt() == null ? null : ws.getNotifyLastAt().format(TS));
            String status = ws.getNotifyLastStatus();
            hook.put("lastStatus", status == null ? null
                    : (status.startsWith("success") ? "success" : sanitize(status, 160)));
        } catch (Exception e) {
            hook.put("configured", false);
        }
        return hook;
    }

    private Map<String, Object> sseInfo() {
        Map<String, Object> sseInfo = new LinkedHashMap<String, Object>();
        sseInfo.put("connections", sse.activeConnections());
        sseInfo.put("users", sse.activeUsers());
        return sseInfo;
    }

    private Map<String, Object> backupInfo() {
        Map<String, Object> backup = new LinkedHashMap<String, Object>();
        try {
            Map<String, Object> lastImport = jdbc.queryForMap(
                    "SELECT action, result, detail, actor_name, created_at FROM audit_log " +
                            "WHERE action IN ('import','clear') ORDER BY id DESC LIMIT 1");
            backup.put("lastImportAction", lastImport.get("action"));
            backup.put("lastImportResult", lastImport.get("result"));
            backup.put("lastImportDetail", lastImport.get("detail"));
            backup.put("lastImportBy", lastImport.get("actor_name"));
            backup.put("lastImportAt", ts(lastImport.get("created_at")));
        } catch (Exception ignored) {
            // 还没有导入/清空记录
        }
        try {
            Map<String, Object> lastExport = jdbc.queryForMap(
                    "SELECT actor_name, detail, created_at FROM audit_log " +
                            "WHERE action = 'export' ORDER BY id DESC LIMIT 1");
            backup.put("lastExportBy", lastExport.get("actor_name"));
            backup.put("lastExportDetail", lastExport.get("detail"));
            backup.put("lastExportAt", ts(lastExport.get("created_at")));
        } catch (Exception ignored) {
            // 还没有导出记录
        }
        return backup;
    }

    private Map<String, Object> auditInfo() {
        Map<String, Object> audit = new LinkedHashMap<String, Object>();
        try {
            Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM audit_log", Integer.class);
            audit.put("total", total == null ? 0 : total);
            audit.put("oldestAt", auditLogMapper.selectOldest(null) == null ? null
                    : auditLogMapper.selectOldest(null).format(TS));
        } catch (Exception ignored) {
            audit.put("total", 0);
        }
        return audit;
    }

    private static String ts(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof java.sql.Timestamp) {
            return ((java.sql.Timestamp) value).toLocalDateTime().format(TS);
        }
        if (value instanceof LocalDateTime) {
            return ((LocalDateTime) value).format(TS);
        }
        return String.valueOf(value);
    }

    /** 推送错误里可能带 webhook 地址/token：只保留错误摘要 */
    private static String sanitize(String value, int max) {
        if (value == null) {
            return null;
        }
        String v = value.replaceAll("https?://\\S+", "[地址已隐藏]");
        return v.length() <= max ? v : v.substring(0, max);
    }

    private static boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
