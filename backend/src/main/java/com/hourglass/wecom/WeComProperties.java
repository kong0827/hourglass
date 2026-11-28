package com.hourglass.wecom;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * 企微免登的全局配置：企业登记、Secret、回调地址都在数据库里按企业配置，这里只放开关与时限。
 */
@Component
public class WeComProperties {

    @Value("${app.wecom.enabled:true}")
    private boolean enabled;

    @Value("${app.wecom.state-ttl-seconds:300}")
    private int stateTtlSeconds;

    @Value("${app.wecom.allowed-callback-hosts:}")
    private String allowedCallbackHosts;

    @Value("${app.wecom.send-max-attempts:3}")
    private int sendMaxAttempts;

    @Value("${app.wecom.send-retry-backoff-seconds:60}")
    private int sendRetryBackoffSeconds;

    @Value("${app.wecom.api-base-url:https://qyapi.weixin.qq.com}")
    private String apiBaseUrl;

    @Value("${app.wecom.login-page:/login.html}")
    private String loginPage;

    public boolean isEnabled() {
        return enabled;
    }

    public int getStateTtlSeconds() {
        return stateTtlSeconds;
    }

    public int getSendMaxAttempts() {
        return sendMaxAttempts;
    }

    public int getSendRetryBackoffSeconds() {
        return sendRetryBackoffSeconds;
    }

    public String getApiBaseUrl() {
        String url = apiBaseUrl == null ? "" : apiBaseUrl.trim();
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    public String getLoginPage() {
        return loginPage == null || loginPage.trim().isEmpty() ? "/login.html" : loginPage.trim();
    }

    public Set<String> allowedHosts() {
        if (allowedCallbackHosts == null || allowedCallbackHosts.trim().isEmpty()) {
            return Collections.emptySet();
        }
        Set<String> hosts = new LinkedHashSet<String>();
        for (String part : allowedCallbackHosts.split(",")) {
            String host = part.trim().toLowerCase(Locale.ROOT);
            if (!host.isEmpty()) {
                hosts.add(host);
            }
        }
        return hosts;
    }

    /** 配了白名单就要求命中；否则放行（本地调试），生产务必配置 */
    public boolean hostAllowed(String host) {
        Set<String> allowed = allowedHosts();
        return allowed.isEmpty() || (host != null && allowed.contains(host.toLowerCase(Locale.ROOT)));
    }
}