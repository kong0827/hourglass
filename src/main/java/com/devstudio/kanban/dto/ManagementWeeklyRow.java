package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDate;

/** 完成/新增按周聚合。 */
@Data
public class ManagementWeeklyRow {
    private LocalDate weekStart;
    private int count;
}
