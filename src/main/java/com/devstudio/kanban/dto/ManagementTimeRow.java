package com.devstudio.kanban.dto;

import lombok.Data;

/** 项目实际工时（time_log 按任务当前 req_id 归属）。 */
@Data
public class ManagementTimeRow {
    private String reqId;
    private int actualMinutes;
}
