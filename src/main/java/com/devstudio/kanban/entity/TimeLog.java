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
}
