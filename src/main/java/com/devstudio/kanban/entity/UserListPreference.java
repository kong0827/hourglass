package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class UserListPreference {

    private String userId;
    private String workspaceId;
    private String viewKey;
    private String viewMode;
    /** 显示列的紧凑 JSON 数组 */
    private String columnsJson;
    private LocalDateTime updatedAt;
}
