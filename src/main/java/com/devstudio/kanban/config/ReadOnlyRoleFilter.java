package com.devstudio.kanban.config;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.LoginUser;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.WorkspaceService;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * exec（只读管理层）写接口保护。
 *
 * <p>放在 Spring Security 认证链之后，按“当前空间角色”拒绝非白名单写请求。
 * 不依赖前端隐藏；GET/HEAD/OPTIONS 一律放行，管理读接口的 owner/exec 校验由
 * {@code @RequireRole(MANAGEMENT)} 负责。</p>
 */
public class ReadOnlyRoleFilter extends OncePerRequestFilter {

    private static final Pattern SELECT_WS = Pattern.compile("^/api/workspaces/[^/]+/select$");
    private static final Pattern MEMBER_READ = Pattern.compile("^/api/notifications/[^/]+/read$");
    private static final Pattern JOIN_INVITE = Pattern.compile("^/api/invite/[^/]+/join$");
    private static final Pattern LEAVE_WS = Pattern.compile("^/api/workspaces/([^/]+)/members/([^/]+)$");

    private final WorkspaceService workspaceService;

    public ReadOnlyRoleFilter(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String uri = request.getRequestURI();
        String method = request.getMethod();
        if (uri == null || !uri.startsWith("/api/")) {
            chain.doFilter(request, response);
            return;
        }
        if ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)
                || "OPTIONS".equalsIgnoreCase(method)) {
            chain.doFilter(request, response);
            return;
        }

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof LoginUser)) {
            chain.doFilter(request, response);
            return;
        }
        String userId = ((LoginUser) auth.getPrincipal()).getId();

        if (isSelfService(uri, method, userId) || uri.startsWith("/api/admin/")) {
            chain.doFilter(request, response);
            return;
        }

        try {
            Workspace ws = workspaceService.resolve(userId, request.getParameter("workspace"));
            if ("exec".equals(ws.getMyRole())) {
                writeForbidden(response);
                return;
            }
        } catch (AppException e) {
            /* 空间不存在/无权访问交给业务层返回 404；这里不额外改写语义 */
        }
        chain.doFilter(request, response);
    }

    private boolean isSelfService(String uri, String method, String userId) {
        if ("POST".equalsIgnoreCase(method)) {
            if ("/api/auth/login".equals(uri) || "/api/auth/logout".equals(uri)
                    || "/api/auth/password".equals(uri) || "/api/workspaces".equals(uri)
                    || "/api/notifications/read-all".equals(uri)) {
                return true;
            }
            if (SELECT_WS.matcher(uri).matches() || MEMBER_READ.matcher(uri).matches()
                    || JOIN_INVITE.matcher(uri).matches()) {
                return true;
            }
        }
        if ("PUT".equalsIgnoreCase(method)
                && ("/api/auth/profile".equals(uri) || "/api/auth/work-hours".equals(uri))) {
            return true;
        }
        if ("DELETE".equalsIgnoreCase(method)) {
            Matcher m = LEAVE_WS.matcher(uri);
            return m.matches() && userId.equals(m.group(2));
        }
        return false;
    }

    private void writeForbidden(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"code\":403,\"message\":\"管理层为只读角色，不能修改业务数据\"}");
    }
}
