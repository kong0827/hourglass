package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 项目仓库绑定：一个项目可绑定多个 GitLab 仓库，只读同步分支与已合并 MR。
 *
 * <p>访问令牌只存 AES-GCM 密文（{@code tokenCipher}），任何读接口只下发
 * {@code tokenConfigured} 布尔值，绝不返回明文或密文。</p>
 */
@Data
public class ProjectRepo {

    private String id;
    private String workspaceId;
    private String reqId;
    private String name;
    /** gitlab */
    private String provider;
    /** GitLab 站点地址，如 https://gitlab.example.com */
    private String repoUrl;
    /** 数字 ID 或 group/project 路径 */
    private String projectRef;
    /** 默认目标分支：同步时排除，不导入 */
    private String defaultTarget;
    /** 令牌密文（AES-GCM） */
    private String tokenCipher;
    /** recent90 / all / manual */
    private String importPolicy;
    private Boolean syncEnabled;
    private LocalDateTime lastSyncAt;
    /** ok / error */
    private String lastSyncStatus;
    private String lastSyncError;
    private String lastSyncSummary;
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /* ---- 非表字段：读接口展示，绝不携带令牌 ---- */
    /** 是否已配置访问令牌 */
    private Boolean tokenConfigured;
    /** 所属项目名 */
    private String reqName;
    /** 该仓库下进行中（outcome=open）的分支数 */
    private Integer openBranchCount;
    /** 该仓库下待确认（outcome=pending）的分支数 */
    private Integer pendingBranchCount;
}
