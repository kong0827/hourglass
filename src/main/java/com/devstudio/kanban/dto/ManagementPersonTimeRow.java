package com.devstudio.kanban.dto;

import lombok.Data;

/** 项目内按人实际工时。 */
@Data
public class ManagementPersonTimeRow {
    private String userId;
    private int actualMinutes;
}
