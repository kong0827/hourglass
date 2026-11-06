package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class TimeLog {

    private Long id;
    private String taskId;
    private String workspaceId;
    /** 计时人（个人计时；同一人同一时刻只允许一个运行中的计时） */
    private String userId;
    private LocalDateTime startedAt;
    private LocalDateTime endedAt;
    private Integer minutes;
    /** timer = 计时器产生；manual = 手工补记（实际工时 = 两类总和） */
    private String origin;
    /** 手工补记备注（计时记录为空） */
    private String note;
}
