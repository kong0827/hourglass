package com.hourglass.config;

import com.hourglass.common.LoginUser;
import com.hourglass.service.SessionEpochService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * 登录与权限：账号来自数据库（UserService，管理员创建下发）；
 * /api/admin/** 仅管理员可访问，其余 /api/** 登录即可。
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /** 前端独立部署后由 Nginx 提供登录页，这里只负责 302 跳转 */
    @Value("${app.login-page:/login.html}")
    private String loginPage;

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, SessionEpochService epochs) throws Exception {
        http
            .addFilterAfter(new SessionEpochFilter(epochs), UsernamePasswordAuthenticationFilter.class)
            .authorizeRequests()
                .antMatchers("/api/health").permitAll()
                // 邀请链接：访客可查看邀请信息（join 加入需登录，走下方 authenticated）
                .antMatchers(HttpMethod.GET, "/api/invite/**").permitAll()
                // 甘特图只读分享：凭 token 访问，不需要登录（只读、无写接口）
                .antMatchers(HttpMethod.GET, "/api/share/**").permitAll()
                .antMatchers("/api/admin/**").hasRole("ADMIN")
                .antMatchers("/api/**").authenticated()
                .anyRequest().permitAll()
            .and()
            .formLogin()
                .loginPage(loginPage)
                .loginProcessingUrl("/api/auth/login")
                .successHandler((req, res, auth) -> {
                    if (auth != null && auth.getPrincipal() instanceof LoginUser) {
                        LoginUser user = (LoginUser) auth.getPrincipal();
                        req.getSession(true).setAttribute(SessionEpochFilter.SESSION_KEY,
                                epochs.current(user.getId()));
                    }
                    writeJson(res, 200, "{\"code\":0,\"message\":\"ok\"}");
                })
                .failureHandler((req, res, ex) -> writeJson(res, 200, "{\"code\":401,\"message\":\"用户名或密码错误\"}"))
            .and()
            .logout()
                .logoutUrl("/api/auth/logout")
                .logoutSuccessHandler((req, res, auth) -> writeJson(res, 200, "{\"code\":0,\"message\":\"ok\"}"))
            .and()
            .exceptionHandling()
                .authenticationEntryPoint((req, res, ex) -> {
                    /* getRequestURI 带 context-path（/hourglass/api/...），须先剥掉再判断 */
                    String uri = req.getRequestURI();
                    String ctx = req.getContextPath();
                    if (uri != null && ctx != null && !ctx.isEmpty() && uri.startsWith(ctx)) {
                        uri = uri.substring(ctx.length());
                    }
                    if (uri != null && uri.startsWith("/api/")) {
                        writeJson(res, 401, "{\"code\":401,\"message\":\"未登录或登录已过期\"}");
                    } else {
                        res.sendRedirect(loginPage.startsWith("http") ? loginPage : (ctx + loginPage));
                    }
                })
                .accessDeniedHandler((req, res, ex) -> writeJson(res, 200, "{\"code\":403,\"message\":\"没有权限执行该操作\"}"))
            .and()
            .csrf().csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse());
        return http.build();
    }

    private void writeJson(HttpServletResponse response, int status, String json) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(json);
    }
}
