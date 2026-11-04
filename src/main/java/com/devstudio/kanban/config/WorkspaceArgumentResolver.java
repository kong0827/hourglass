package com.devstudio.kanban.config;

import com.devstudio.kanban.common.CurrentUser;
import com.devstudio.kanban.common.CurrentWorkspace;
import com.devstudio.kanban.common.RequireRole;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.service.WorkspaceService;
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
        if (role != null && RequireRole.OWNER.equals(role.value())
                && !"owner".equals(ws.getMyRole())) {
            throw new com.devstudio.kanban.common.AppException(403, "仅空间主可执行该操作");
        }
        /* 查看者全局只读：所有带空间上下文的写请求统一拦截，避免各接口各写一遍 */
        if ("viewer".equals(ws.getMyRole()) && isWriteRequest(request)) {
            throw new com.devstudio.kanban.common.AppException(403, "你在此空间是查看者，只能查看不能修改");
        }
        return new WorkspaceCtx(userId, ws);
    }

    private static boolean isWriteRequest(NativeWebRequest request) {
        javax.servlet.http.HttpServletRequest raw = request.getNativeRequest(javax.servlet.http.HttpServletRequest.class);
        String method = raw == null ? null : raw.getMethod();
        return "POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method)
                || "PATCH".equalsIgnoreCase(method) || "DELETE".equalsIgnoreCase(method);
    }
}
