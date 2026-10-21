package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class SavedView {

    private String id;
    private String userId;
    private String workspaceId;
    private String name;
    /** 筛选参数 JSON 字符串 */
    private String params;
    private LocalDateTime createdAt;
}
