package com.hourglass.common;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * 当前登录用户快捷访问（/api/** 均已要求登录，取不到即 401）
 */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static LoginUser get() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof LoginUser)) {
            throw new AppException(401, "未登录或登录已过期");
        }
        return (LoginUser) auth.getPrincipal();
    }

    public static String id() {
        return get().getId();
    }
}
