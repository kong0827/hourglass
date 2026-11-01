package com.devstudio.kanban.config;

import com.devstudio.kanban.entity.Workspace;

/** 控制器里的「当前空间 + 登录人」上下文（BE-ARCH-2） */
public class WorkspaceCtx {

    private final String userId;
    private final Workspace workspace;

    public WorkspaceCtx(String userId, Workspace workspace) {
        this.userId = userId;
        this.workspace = workspace;
    }

    public String getUserId() { return userId; }

    public Workspace getWorkspace() { return workspace; }

    public String getWsId() { return workspace == null ? null : workspace.getId(); }
}
