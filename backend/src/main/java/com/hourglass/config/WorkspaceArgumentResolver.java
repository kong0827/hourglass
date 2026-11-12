package com.hourglass.config;

import com.hourglass.common.CurrentUser;
import com.hourglass.common.CurrentWorkspace;
import com.hourglass.common.RequireRole;
import com.hourglass.entity.Workspace;
import com.hourglass.service.WorkspaceService;
import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * {@code @CurrentWorkspace WorkspaceCtx} 参数解析器。
 * 顺带处理 {@link RequireRole}：角色校验放在解析阶段，所有用到空间上下文的接口自动生效，
 * 避免每个控制器各写一遍 requireOwner。
 */
@Component
public class WorkspaceArgumentResolver implements HandlerMethodArgumentResolver {

    private final WorkspaceService workspaceService;

    public WorkspaceArgumentResolver(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentWorkspace.class)
                && WorkspaceCtx.class.isAssignableFrom(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
                                  NativeWebRequest request, WebDataBinderFactory binderFactory) {
        String userId = CurrentUser.id();
        String wsParam = request.getParameter("workspace");
        RequireRole role = parameter.getMethodAnnotation(RequireRole.class);
        Workspace ws = workspaceService.resolve(userId, wsParam);
        if (role != null && !roleAllowed(ws.getMyRole(), role.value())) {
            throw new com.hourglass.common.AppException(403,
                    RequireRole.ADMIN.equals(role.value()) ? "仅空间主或管理员可执行该操作" : "仅空间主可执行该操作");
        }
        /* 查看者全局只读：所有带空间上下文的写请求统一拦截，避免各接口各写一遍 */
        if ("viewer".equals(ws.getMyRole()) && isWriteRequest(request)) {
            throw new com.hourglass.common.AppException(403, "你在此空间是查看者，只能查看不能修改");
        }
        return new WorkspaceCtx(userId, ws);
    }

    private static boolean roleAllowed(String myRole, String required) {
        if (RequireRole.ADMIN.equals(required)) {
            return "owner".equals(myRole) || "admin".equals(myRole);
        }
        return "owner".equals(myRole);
    }

    private static boolean isWriteRequest(NativeWebRequest request) {
        javax.servlet.http.HttpServletRequest raw = request.getNativeRequest(javax.servlet.http.HttpServletRequest.class);
        String method = raw == null ? null : raw.getMethod();
        return "POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method)
                || "PATCH".equalsIgnoreCase(method) || "DELETE".equalsIgnoreCase(method);
    }
}
