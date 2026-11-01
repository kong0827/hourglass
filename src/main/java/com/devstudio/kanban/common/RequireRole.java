package com.devstudio.kanban.common;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 声明式空间角色校验（BE-ARCH-2）。
 * 标在控制器方法上，参数解析时校验当前空间角色；不足时抛 403（HTTP 403 + code=403）。
 * 目前只有 OWNER 一种角色，普通成员不满足。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireRole {

    String OWNER = "OWNER";

    String value() default OWNER;
}
