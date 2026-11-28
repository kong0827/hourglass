package com.hourglass.config;

import com.hourglass.dto.ApiTokenAuth;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/** 令牌请求限流：只处理已通过 ApiTokenAuthFilter 的请求，其余原样放行 */
public class ApiTokenRateLimitFilter extends OncePerRequestFilter {

    private final ApiTokenRateLimiter limiter;

    public ApiTokenRateLimitFilter(ApiTokenRateLimiter limiter) {
        this.limiter = limiter;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Object attr = request.getAttribute(ApiTokenAuthFilter.ATTR_AUTH);
        if (!(attr instanceof ApiTokenAuth)) {
            chain.doFilter(request, response);
            return;
        }
        ApiTokenAuth auth = (ApiTokenAuth) attr;
        boolean write = !ApiTokenAuthFilter.isSafeMethod(request.getMethod());
        if (!limiter.allow(auth.getToken().getId(), write)) {
            response.setStatus(429);
            response.setHeader("Retry-After", "60");
            response.setContentType("application/json");
            response.setCharacterEncoding("UTF-8");
            response.getWriter().write("{\"code\":429,\"message\":\"请求过于频繁，请稍后再试\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}