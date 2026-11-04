package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 流程体检：任务快照（只取算指标需要的列） */
@Data
public class FlowTaskRow {

    private String id;
    private String reqId;
    private String title;
    private String priority;
    private String boardColumn;
    private LocalDateTime createdAt;
    private LocalDate completedAt;
    private String reqDocId;
}
