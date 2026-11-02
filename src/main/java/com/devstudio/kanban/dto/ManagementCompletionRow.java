package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDate;

/** 项目最近完成日期（完成快照口径）。 */
@Data
public class ManagementCompletionRow {
    private String reqId;
    private LocalDate lastAt;
}
