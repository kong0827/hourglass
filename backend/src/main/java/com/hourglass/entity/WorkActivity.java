package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 项目、需求文档等业务实体的活动轨迹。 */
@Data
public class WorkActivity {

    private Long id;
    private String workspaceId;
    private String entityType;
    private String entityId;
    private String actorId;
    /** 写入时的操作人显示名快照，不随用户改名而变化。 */
    private String actorName;
    private String action;
    private String detail;
    private LocalDateTime createdAt;
}
