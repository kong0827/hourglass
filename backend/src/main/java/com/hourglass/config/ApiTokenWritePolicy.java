package com.hourglass.config;

import org.springframework.util.AntPathMatcher;

import java.util.Arrays;
import java.util.List;

/**
 * 写令牌的路径白名单：只开与 AI 助手同权的四类动作（建工作项、工作项列流转、提需求、需求流转）。
 *
 * <p>不按「非安全方法全放行」，因为空间设置、删除、成员管理、自动化规则都在其他 POST 路径上；
 * 令牌一旦泄漏，扩大写面等于扩大破坏面。放开新的写能力时同时改这里与 OpenAPI 白名单。
 */
public final class ApiTokenWritePolicy {

    /** 「POST 路径模式」；模式按 AntPathMatcher 解释，* 只匹配一段 */
    private static final List<String> RULES = Arrays.asList(
            "POST /api/tasks",
            "POST /api/tasks/*/move",
            "POST /api/demands",
            "POST /api/demands/*/pass",
            "POST /api/demands/*/rej",
            "POST /api/demands/*/plan",
            "POST /api/demands/*/replan",
            "POST /api/demands/*/unpass",
            "POST /api/demands/*/unplan",
            "POST /api/demands/*/cancel",
            "POST /api/demands/*/restore",
            "POST /api/demands/*/reopen");

    private static final AntPathMatcher MATCHER = new AntPathMatcher();

    private ApiTokenWritePolicy() {
    }

    public static boolean allows(String method, String path) {
        if (method == null || path == null) {
            return false;
        }
        String verb = method.toUpperCase();
        for (String rule : RULES) {
            int space = rule.indexOf(' ');
            if (space < 0 || !rule.substring(0, space).equals(verb)) {
                continue;
            }
            if (MATCHER.match(rule.substring(space + 1), path)) {
                return true;
            }
        }
        return false;
    }

    /** 供错误提示与文档使用，保持与白名单同一句话 */
    public static String summary() {
        return "建工作项、工作项列流转、提需求与需求流转";
    }
}