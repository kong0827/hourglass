package com.hourglass.wecom;

import java.util.regex.Pattern;

/**
 * 回调后的跳转目标只允许站内路径。
 * 企微授权链接里的 target 可以被任何人构造，若不校验就能把刚登录的会话带去外部站点。
 */
public final class WeComSafePath {

    private static final Pattern INTERNAL = Pattern.compile("^/[A-Za-z0-9._~!$&'()*+,;=:@%/?#\\[\\]-]{0,600}$");

    private WeComSafePath() {
    }

    /** 返回可安全跳转的站内路径；不合法时退回 / */
    public static String of(String raw, String fallback) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()
                || value.startsWith("//")
                || value.contains("\\")
                || value.contains("\r")
                || value.contains("\n")
                || value.toLowerCase().startsWith("/login")
                || value.toLowerCase().startsWith("/wecom/")) {
            return fallback == null || fallback.isEmpty() ? "/" : fallback;
        }
        if (!INTERNAL.matcher(value).matches()) {
            return fallback == null || fallback.isEmpty() ? "/" : fallback;
        }
        return value;
    }
}