package com.hourglass.entity;

import java.time.LocalDateTime;

public class ReleasePlanShare {

    private String workspaceId;
    private String planId;
    private String token;
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime revokedAt;

    public String getWorkspaceId() { return workspaceId; }
    public void setWorkspaceId(String workspaceId) { this.workspaceId = workspaceId; }

    public String getPlanId() { return planId; }
    public void setPlanId(String planId) { this.planId = planId; }

    public String getToken() { return token; }
    public void setToken(String token) { this.token = token; }

    public String getCreatedBy() { return createdBy; }
    public void setCreatedBy(String createdBy) { this.createdBy = createdBy; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getRevokedAt() { return revokedAt; }
    public void setRevokedAt(LocalDateTime revokedAt) { this.revokedAt = revokedAt; }
}
