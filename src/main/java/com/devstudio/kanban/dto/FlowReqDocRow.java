package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 流程体检：需求及其首个关联任务的创建时间（衡量「写完需求多久才开工」） */
@Data
public class FlowReqDocRow {

    private String id;
    private String title;
    private String status;
    private LocalDateTime createdAt;
    /** 首个关联任务的创建时间；没有任务时为 null */
    private LocalDateTime firstTaskAt;
    private Integer taskCount;
}
