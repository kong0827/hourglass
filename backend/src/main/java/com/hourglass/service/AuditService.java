package com.hourglass.service;

import com.hourglass.common.CurrentUser;
import com.hourglass.common.LoginUser;
import com.hourglass.common.Texts;
import com.hourglass.entity.AuditLog;
import com.hourglass.mapper.AuditLogMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import javax.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 系统审计（管理员可见）：登录、权限变更、导出/导入、删除/清空等安全事件。
 * 与 task_log 分开存储，避免任务操作噪音淹没安全事件；写入失败不阻断业务。
 */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);
    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final int MAX_DETAIL = 500;
    private static final int MAX_EXPORT = 10000;

    private final AuditLogMapper mapper;

    @Value("${app.audit.retain-days:90}")
    private int retainDays;

    public AuditService(AuditLogMapper mapper) {
        this.mapper = mapper;
    }

    public void record(String workspaceId, String actorId, String actorName, String action,
                       String targetType, String targetId, String targetName,
                       boolean success, String detail, String ip) {
        try {
            AuditLog a = new AuditLog();
            a.setWorkspaceId(Texts.trimToNull(workspaceId));
            a.setActorId(Texts.trimToNull(actorId));
            a.setActorName(Texts.cut(Texts.trimToNull(actorName), 64));
            a.setAction(action);
            a.setTargetType(Texts.trimToNull(targetType));
            a.setTargetId(Texts.cut(Texts.trimToNull(targetId), 64));
            a.setTargetName(Texts.cut(Texts.trimToNull(targetName), 128));
            a.setResult(success ? "success" : "fail");
            a.setDetail(Texts.cut(Texts.trimToNull(detail), MAX_DETAIL));
            a.setIp(Texts.cut(Texts.trimToNull(ip), 64));
            mapper.insert(a);
        } catch (Exception e) {
            log.warn("审计日志写入失败（action={} target={}）：{}", action, targetId, detail, e);
        }
    }

    /** 当前登录人 + 当前请求的便捷入口 */
    public void recordCurrent(String workspaceId, String action, String targetType, String targetId,
                              String targetName, boolean success, String detail, HttpServletRequest request) {
        String actorId = null;
        String actorName = null;
        try {
            LoginUser u = CurrentUser.get();
            actorId = u.getId();
            actorName = u.getDisplayName();
        } catch (Exception ignored) {
            // 无请求上下文时留空，审计本身不抛错
        }
        record(workspaceId, actorId, actorName, action, targetType, targetId, targetName,
                success, detail, clientIp(request));
    }

    public void recordLogin(LoginUser user, String username, boolean success, String detail,
                            HttpServletRequest request) {
        record(null, user == null ? null : user.getId(),
                user == null ? username : user.getDisplayName(),
                success ? "login" : "login_fail", "auth", username, username,
                success, detail, clientIp(request));
    }

    public void recordLogout(LoginUser user, HttpServletRequest request) {
        record(null, user.getId(), user.getDisplayName(), "logout", "auth",
                user.getUsername(), user.getUsername(), true, "退出登录", clientIp(request));
    }

    public Map<String, Object> page(String workspaceId, String q, String action, String result,
                                    String actorId, String from, String to,
                                    Integer page, Integer size) {
        int p = page == null || page < 1 ? 1 : page;
        int s = size == null ? 50 : Math.max(10, Math.min(100, size));
        LocalDateTime fromTs = startOfDay(parseDate(from));
        LocalDateTime toTs = endOfDayExclusive(parseDate(to));
        String kw = Texts.cut(Texts.trimToNull(q), 80);

        int total = mapper.count(workspaceId, kw, Texts.trimToNull(action), Texts.trimToNull(result),
                Texts.trimToNull(actorId), fromTs, toTs);
        int maxPage = Math.max(1, (total + s - 1) / s);
        if (p > maxPage) {
            p = maxPage;
        }
        List<AuditLog> items = total == 0 ? java.util.Collections.<AuditLog>emptyList()
                : mapper.selectPage(workspaceId, kw, Texts.trimToNull(action), Texts.trimToNull(result),
                Texts.trimToNull(actorId), fromTs, toTs, (p - 1) * s, s);

        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("items", items);
        data.put("total", total);
        data.put("page", p);
        data.put("size", s);
        data.put("hasMore", (long) p * s < total);
        data.put("retentionDays", retainDays);
        data.put("oldestAt", mapper.selectOldest(workspaceId));
        return data;
    }

    public byte[] exportCsv(String workspaceId, String q, String action, String result,
                            String actorId, String from, String to) {
        LocalDateTime fromTs = startOfDay(parseDate(from));
        LocalDateTime toTs = endOfDayExclusive(parseDate(to));
        List<AuditLog> list = mapper.selectForExport(workspaceId, Texts.cut(Texts.trimToNull(q), 80),
                Texts.trimToNull(action), Texts.trimToNull(result), Texts.trimToNull(actorId),
                fromTs, toTs, MAX_EXPORT);
        StringBuilder sb = new StringBuilder("\uFEFF");
        sb.append("时间,操作人,动作,对象类型,对象,结果,IP,详情\r\n");
        for (AuditLog a : list) {
            sb.append(csv(a.getCreatedAt() == null ? "" : a.getCreatedAt().format(TS))).append(',')
                    .append(csv(a.getActorName())).append(',')
                    .append(csv(actionLabel(a.getAction()))).append(',')
                    .append(csv(a.getTargetType())).append(',')
                    .append(csv(a.getTargetName() == null ? a.getTargetId() : a.getTargetName())).append(',')
                    .append(csv("fail".equals(a.getResult()) ? "失败" : "成功")).append(',')
                    .append(csv(a.getIp())).append(',')
                    .append(csv(a.getDetail())).append("\r\n");
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    public void purgeExpired() {
        LocalDateTime cutoff = LocalDateTime.now().minusDays(Math.max(1, retainDays));
        try {
            int n = mapper.deleteBefore(cutoff);
            if (n > 0) {
                log.info("审计日志清理完成：删除 {} 条（保留 {} 天）", n, retainDays);
            }
        } catch (Exception e) {
            log.warn("审计日志清理失败", e);
        }
    }

    /** 每天 03:40 清理超过保留期的审计日志 */
    @Scheduled(cron = "${app.audit.purge-cron:0 40 3 * * *}")
    public void scheduledPurge() {
        purgeExpired();
    }

    public static String clientIp(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        String ip = request.getHeader("X-Forwarded-For");
        if (ip != null && !ip.trim().isEmpty()) {
            int comma = ip.indexOf(',');
            return (comma > 0 ? ip.substring(0, comma) : ip).trim();
        }
        ip = request.getHeader("X-Real-IP");
        if (ip != null && !ip.trim().isEmpty()) {
            return ip.trim();
        }
        return request.getRemoteAddr();
    }

    private static LocalDate parseDate(String value) {
        String v = Texts.trimToNull(value);
        if (v == null) {
            return null;
        }
        try {
            return LocalDate.parse(v.length() > 10 ? v.substring(0, 10) : v);
        } catch (Exception e) {
            return null;
        }
    }

    private static LocalDateTime startOfDay(LocalDate date) {
        return date == null ? null : date.atStartOfDay();
    }

    private static LocalDateTime endOfDayExclusive(LocalDate date) {
        return date == null ? null : date.plusDays(1).atStartOfDay();
    }

    private static String csv(String value) {
        if (value == null) {
            return "";
        }
        String v = value.replace("\"", "\"\"");
        if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0) {
            return "\"" + v + "\"";
        }
        return v;
    }

    private static String actionLabel(String action) {
        if (action == null) {
            return "";
        }
        switch (action) {
            case "login": return "登录成功";
            case "login_fail": return "登录失败";
            case "logout": return "退出登录";
            case "export": return "数据导出";
            case "import": return "备份恢复";
            case "clear": return "清空数据";
            case "role_change": return "权限变更";
            case "member_add": return "添加成员";
            case "member_remove": return "移除成员";
            case "member_company": return "标注成员公司";
            case "project_role": return "标注项目角色";
            case "invite_create": return "生成邀请链接";
            case "invite_revoke": return "撤销邀请链接";
            case "password_change": return "修改密码";
            case "profile_update": return "修改个人资料";
            case "work_hours_update": return "修改计时设置";
            case "mail_settings_update": return "修改邮件服务器";
            case "ai_config_update": return "修改 AI 配置";
            case "gantt_share_create": return "生成甘特分享";
            case "gantt_share_revoke": return "撤销甘特分享";
            case "test_case_delete": return "删除测试用例";
            case "test_case_import": return "导入测试用例";
            case "test_plan_delete": return "删除测试计划";
            case "test_plan_status": return "测试计划状态变更";
            case "comment_delete": return "删除评论";
            case "workspace_delete": return "删除空间";
            case "project_delete": return "删除项目";
            case "task_purge": return "彻底删除任务";
            case "demand_delete": return "删除需求";
            case "requirement_doc_delete": return "删除需求文档";
            case "branch_delete": return "删除分支";
            case "version_delete": return "删除版本";
            case "user_create": return "创建账号";
            case "user_update": return "修改账号";
            case "user_delete": return "删除账号";
            case "user_disable": return "禁用账号";
            case "user_enable": return "启用账号";
            case "password_reset": return "重置密码";
            default: return action;
        }
    }
}
