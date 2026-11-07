package com.hourglass.common;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 控制器方法参数注解：由 {@code WorkspaceArgumentResolver} 解析出当前空间 + 登录人。
 * 解析规则与原来的 {@code workspaceService.resolve(userId, workspace)} 完全一致
 * （显式 workspace 严格校验；缺省时用上次空间，再退回个人空间）。
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentWorkspace {
}
