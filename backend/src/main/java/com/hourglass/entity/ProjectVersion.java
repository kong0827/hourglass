package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class ProjectVersion {

    private String id;
    private String workspaceId;
    private String reqId;
    private String name;
    private String description;
    /** planned/active/released/closed/canceled */
    private String status;
    private LocalDate startDate;
    private LocalDate targetDate;
    private LocalDateTime releasedAt;
    /** 关闭或取消的时间 */
    private LocalDateTime endedAt;
    /** 关闭或取消原因 */
    private String endReason;
    /** 开始开发时的承诺基线快照时间；历史版本可能为空 */
    private LocalDateTime commitmentAt;
    private Long revision = 0L;
    private Boolean canManageReleasePlan;
    private Boolean canPublish;
    /** 内容只读：已有成功的生产部署 / 重部署（正式交付）；测试环境部署与回滚不锁定。非持久化字段 */
    private Boolean contentLocked;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    private Integer taskCount;
    private Integer doneCount;
    private Integer progressPct;
    private List<Task> tasks;
}
