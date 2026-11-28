package com.hourglass.config;

import org.springframework.security.web.util.matcher.RequestMatcher;

import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServletRequest;

/**
 * CSRF 边界：安全方法放行；只有「Bearer 且无会话 Cookie」的请求跳过 CSRF。
 *
 * <p>带会话 Cookie 的请求一律要求 CSRF，避免「Bearer 头存在就整体放行」被当成绕过口子；
 * 跨站表单没有自定义 Authorization 头，仍然会被拦截。
 */
public class TokenAwareCsrfRequestMatcher implements RequestMatcher {

    private static final String BEARER = "Bearer ";
    private static final String SESSION_COOKIE = "JSESSIONID";

    @Override
    public boolean matches(HttpServletRequest request) {
        String method = request.getMethod();
        if ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)
                || "OPTIONS".equalsIgnoreCase(method) || "TRACE".equalsIgnoreCase(method)) {
            return false;
        }
        String header = request.getHeader("Authorization");
        boolean bearer = header != null && header.regionMatches(true, 0, BEARER, 0, BEARER.length());
        return !(bearer && !hasSessionCookie(request));
    }

    private static boolean hasSessionCookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return false;
        }
        for (Cookie cookie : cookies) {
            if (SESSION_COOKIE.equals(cookie.getName())) {
                return true;
            }
        }
        return false;
    }
}