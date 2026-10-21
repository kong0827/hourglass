package com.devstudio.kanban.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class AppUser {

    private String id;
    private String username;
    /** never 序列化给前端 */
    @JsonIgnore
    private String passwordHash;
    private String displayName;
    /** admin/user（只管账号，不等于空间权限） */
    private String role;
    private String lastWorkspaceId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
