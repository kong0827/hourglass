package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 流程体检：一条跨列移动事件。
 * from/to 列优先取结构化字段（新数据），为空时由 Service 从 detail 文本兜底解析（历史数据）。
 */
@Data
public class FlowMoveRow {

    private String taskId;
    private String fromColumn;
    private String toColumn;
    private String detail;
    private LocalDateTime createdAt;
}
