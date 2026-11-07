package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 任务依赖：from（前驱）→ to（后继），支持 FS/SS/FF/SF 与滞后 */
@Data
public class TaskDependency {

    private String id;
    private String workspaceId;
    private String fromTaskId;
    private String toTaskId;
    /** FS / SS / FF / SF */
    private String depType;
    private Integer lagDays;
    private LocalDateTime createdAt;
}
