package com.hourglass.config;

import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.web.context.HttpRequestResponseHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpServletResponseWrapper;

/**
 * 令牌请求不落会话。
 *
 * <p>默认的 {@link HttpSessionSecurityContextRepository} 会在响应提交时自动把认证写进
 * HttpSession（{@code SaveToSessionResponseWrapper}），单靠重写 {@code saveContext} 拦不住。
 * 这里对 Bearer 请求换掉保存包装器，并跳过显式 saveContext，避免 API 调用生成会话，
 * 也避免 CSRF 判定因为客户端带回 JSESSIONID 而变严。
 */
public class BearerAwareSecurityContextRepository extends HttpSessionSecurityContextRepository {

    private static final String BEARER = "Bearer ";

    @Override
    public SecurityContext loadContext(HttpRequestResponseHolder holder) {
        HttpServletResponse response = holder.getResponse();
        SecurityContext context = super.loadContext(holder);
        if (isBearer(holder.getRequest())) {
            holder.setResponse(new HttpServletResponseWrapper(response));
        }
        return context;
    }

    @Override
    public void saveContext(SecurityContext context, HttpServletRequest request, HttpServletResponse response) {
        if (isBearer(request)) {
            return;
        }
        super.saveContext(context, request, response);
    }

    private static boolean isBearer(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        return header != null && header.regionMatches(true, 0, BEARER, 0, BEARER.length());
    }
}