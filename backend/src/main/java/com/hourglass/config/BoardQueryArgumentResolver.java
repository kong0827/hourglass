package com.hourglass.config;

import com.hourglass.common.BoardFilter;
import com.hourglass.dto.BoardQuery;
import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * {@code BoardQuery} 参数解析器（BE-ARCH-2）。
 * 看板 / 已完成 / 列表 / 日历 / 甘特原本各自重复声明 13 个 @RequestParam，
 * 这里统一从 query string 构造，HTTP 参数名与语义完全不变。
 */
@Component
public class BoardQueryArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(BoardFilter.class)
                && BoardQuery.class.isAssignableFrom(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
                                  NativeWebRequest request, WebDataBinderFactory binderFactory) {
        return BoardQuery.from(
                request.getParameter("q"),
                request.getParameter("owners"),
                request.getParameter("pris"),
                request.getParameter("cats"),
                request.getParameter("reqs"),
                request.getParameter("tags"),
                request.getParameter("types"),
                request.getParameter("versions"),
                request.getParameter("due"),
                bool(request.getParameter("focus")),
                bool(request.getParameter("blocked")),
                bool(request.getParameter("noDue")),
                request.getParameter("doneScope"),
                integer(request.getParameter("doneLimit")),
                integer(request.getParameter("doneOffset")),
                integer(request.getParameter("openLimit")),
                request.getParameter("columns"),
                request.getParameter("completion"));
    }

    private Boolean bool(String v) {
        if (v == null || v.trim().isEmpty()) {
            return null;
        }
        return "true".equalsIgnoreCase(v.trim()) || "1".equals(v.trim());
    }

    private Integer integer(String v) {
        if (v == null || v.trim().isEmpty()) {
            return null;
        }
        try {
            return Integer.valueOf(v.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
