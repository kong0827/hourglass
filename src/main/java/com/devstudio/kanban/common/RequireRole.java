package com.devstudio.kanban.common;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 声明式空间角色校验（BE-ARCH-2）。
 * 标在控制器方法上，参数解析时校验当前空间角色；不足时抛 403（HTTP 403 + code=403）。
 * OWNER：仅空间主；MANAGEMENT：空间主或管理层 exec。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireRole {

    String OWNER = "OWNER";
    String MANAGEMENT = "MANAGEMENT";

    String value() default OWNER;
}
