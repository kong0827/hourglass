package com.hourglass.common;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标记统一筛选参数（q / owners / pris / cats / reqs / tags / due / focus / blocked / noDue /
 * doneScope / doneLimit / doneOffset）。由 BoardQueryArgumentResolver 从 query string 构造，
 * 避免每个接口重复声明十几个 @RequestParam。
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface BoardFilter {
}
