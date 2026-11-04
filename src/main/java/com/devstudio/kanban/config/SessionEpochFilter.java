package com.devstudio.kanban.config;

import com.devstudio.kanban.common.LoginUser;
import com.devstudio.kanban.service.SessionEpochService;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;

/**
 * 密码修改/重置/角色变更后，让该账号的旧会话立即失效。
 *
 * <p>登录时在 HttpSession 写入 {@link SessionEpochService} 的当前代次；每次 /api/ 请求比对。
 * 不匹配则清掉会话返回 401。静态资源和登录页不拦截。</p>
 */
public class SessionEpochFilter extends OncePerRequestFilter {

    public static final String SESSION_KEY = "hourglass.sessionEpoch";

    private final SessionEpochService epochs;

    public SessionEpochFilter(SessionEpochService epochs) {
        this.epochs = epochs;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String uri = request.getRequestURI();
        String ctx = request.getContextPath();
        if (uri != null && ctx != null && !ctx.isEmpty() && uri.startsWith(ctx)) {
            uri = uri.substring(ctx.length());
        }
        if (uri == null || !uri.startsWith("/api/") || "/api/auth/login".equals(uri)) {
            chain.doFilter(request, response);
            return;
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof LoginUser)) {
            chain.doFilter(request, response);
            return;
        }
        LoginUser user = (LoginUser) auth.getPrincipal();
        HttpSession session = request.getSession(false);
        Object stored = session == null ? null : session.getAttribute(SESSION_KEY);
        Long epoch = stored instanceof Number ? ((Number) stored).longValue() : null;
        if (session == null || epoch == null || epoch != epochs.current(user.getId())) {
            if (session != null) {
                try {
                    session.invalidate();
                } catch (IllegalStateException ignored) {
                    /* 已失效 */
                }
            }
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.setCharacterEncoding("UTF-8");
            response.getWriter().write("{\"code\":401,\"message\":\"登录已失效，请重新登录\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
