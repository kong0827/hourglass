package com.hourglass.config;

import com.hourglass.common.LoginUser;
import com.hourglass.dto.ApiTokenAuth;
import com.hourglass.service.ApiTokenService;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * 个人访问令牌鉴权：只处理 Authorization: Bearer，没有该头时完全不影响会话链路。
 *
 * <p>令牌请求不建会话；管理员接口、令牌管理接口与改密接口对令牌一律关闭；
 * 非写令牌拒绝一切写方法。校验失败直接 401，不回落匿名。
 */
public class ApiTokenAuthFilter extends OncePerRequestFilter {

    public static final String ATTR_AUTH = "hg.apiTokenAuth";
    public static final String AUTHORITY = "API_TOKEN";
    private static final String BEARER = "Bearer ";
    private static final Logger log = LoggerFactory.getLogger(ApiTokenAuthFilter.class);

    private final ApiTokenService tokenService;

    public ApiTokenAuthFilter(ApiTokenService tokenService) {
        this.tokenService = tokenService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null || !header.regionMatches(true, 0, BEARER, 0, BEARER.length())) {
            chain.doFilter(request, response);
            return;
        }
        String raw = header.substring(BEARER.length()).trim();
        if (raw.isEmpty()) {
            writeJson(response, 401, "缺少访问令牌");
            return;
        }
        ApiTokenAuth auth = tokenService.authenticate(raw);
        if (auth == null) {
            /* 失败只留调试线索：路径 + 来源 IP，绝不记录令牌本身 */
            log.debug("API 令牌校验失败：{} {} 来源 {}", request.getMethod(), path(request), request.getRemoteAddr());
            writeJson(response, 401, "令牌无效或已失效");
            return;
        }
        String path = path(request);
        if (path.startsWith("/api/admin/") || path.startsWith("/api/auth/tokens")
                || path.startsWith("/api/auth/password")) {
            writeJson(response, 403, "访问令牌无权调用该接口");
            return;
        }
        if (!isSafeMethod(request.getMethod())) {
            if (!ApiTokenService.SCOPE_WRITE.equals(auth.getToken().getScope())) {
                writeJson(response, 403, "只读令牌不能执行写操作");
                return;
            }
            if (!ApiTokenWritePolicy.allows(request.getMethod(), path)) {
                writeJson(response, 403, "令牌无权执行该写操作（只开放" + ApiTokenWritePolicy.summary() + "）");
                return;
            }
        }

        LoginUser principal = new LoginUser(auth.getUser().getId(), auth.getUser().getUsername(), "",
                auth.getUser().getDisplayName(), auth.getUser().getRole());
        List<GrantedAuthority> authorities = new ArrayList<GrantedAuthority>(principal.getAuthorities());
        authorities.add(new SimpleGrantedAuthority(AUTHORITY));
        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(principal, null, authorities);
        /* 必须换一个新的 SecurityContext：带 Bearer 的同源请求可能同时有登录会话，
           直接改当前上下文会连会话里存的那份一起改成令牌身份（API_TOKEN），
           之后普通页面请求就会被令牌管理/管理员接口按令牌拒绝。 */
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        request.setAttribute(ATTR_AUTH, auth);
        chain.doFilter(request, response);
    }

    static boolean isSafeMethod(String method) {
        return "GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)
                || "OPTIONS".equalsIgnoreCase(method) || "TRACE".equalsIgnoreCase(method);
    }

    private static String path(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String ctx = request.getContextPath();
        if (uri != null && ctx != null && !ctx.isEmpty() && uri.startsWith(ctx)) {
            uri = uri.substring(ctx.length());
        }
        return uri == null ? "" : uri;
    }

    private static void writeJson(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"code\":" + status + ",\"message\":\"" + message + "\"}");
    }
}