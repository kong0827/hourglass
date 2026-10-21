package com.devstudio.kanban.config;

import com.devstudio.kanban.common.GlobalExceptionHandler;
import com.devstudio.kanban.common.LoginUser;
import com.devstudio.kanban.service.SseService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 所有成功的数据变更请求（非 GET 的 /api/*）完成后广播 SSE 通知。
 * 广播只是刷新通知：任何广播失败都不影响已成功的业务响应。
 *
 * O-11：载荷补上 taskId 与操作人显示名，前端才能判断
 * "是不是当前打开着的那条任务被改了"，从而提示"此任务刚被 X 修改"而不是静默不更新。
 */
@Component
public class ChangeBroadcastFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(ChangeBroadcastFilter.class);
    /** 从 /api/tasks/{id}/... 取出任务ID（list/done 等字面量路径不会被非 GET 请求命中） */
    private static final Pattern TASK_PATH = Pattern.compile("^/api/tasks/([A-Za-z0-9_-]{1,32})(/.*)?$");

    private final SseService sseService;

    public ChangeBroadcastFilter(SseService sseService) {
        this.sseService = sseService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        chain.doFilter(request, response);

        String uri = request.getRequestURI();
        if (uri == null || !uri.startsWith("/api/")) {
            return;
        }
        if ("GET".equalsIgnoreCase(request.getMethod())) {
            return;
        }
        if (uri.startsWith("/api/auth/") || uri.startsWith("/api/notify/") || uri.startsWith("/api/events")) {
            return;
        }
        /* 通知的「标记已读」是收件人私事，不改动任何共享数据，不应触发他人刷新 */
        if (uri.startsWith("/api/notifications")) {
            return;
        }
        int status = response.getStatus();
        if (status < 200 || status >= 300) {
            return;
        }
        /* 第九轮审查 #4：业务失败也是 HTTP 200（错误码在响应体里），
           若只看状态码，被业务规则拒绝的写请求也会触发一次全空间刷新。
           异常处理器已在 request 上打了失败标记，这里据此跳过。 */
        if (Boolean.TRUE.equals(request.getAttribute(GlobalExceptionHandler.FAILED_ATTR))) {
            return;
        }
        try {
            // 带上空间粒度：服务端按空间成员投递，客户端再按"自己当前空间"过滤
            String workspace = request.getParameter("workspace");
            Matcher m = TASK_PATH.matcher(uri);
            String taskId = m.matches() ? m.group(1) : null;
            String actor = currentDisplayName();
            sseService.broadcast("changed", workspace, taskId, actor);
        } catch (Exception e) {
            log.warn("SSE 广播异常（业务请求已成功，仅影响刷新通知）", e);
        }
    }

    /** 操作人显示名（取不到就留空：前端会退化为"他人"文案，不影响功能） */
    private String currentDisplayName() {
        try {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getPrincipal() instanceof LoginUser) {
                return ((LoginUser) auth.getPrincipal()).getDisplayName();
            }
        } catch (Exception e) {
            // 忽略：载荷里的操作人只是提示信息
        }
        return null;
    }
}
