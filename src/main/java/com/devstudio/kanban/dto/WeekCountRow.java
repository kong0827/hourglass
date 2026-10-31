package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDate;

/** 按周聚合的新增 / 完成数（报表折线） */
@Data
public class WeekCountRow {

    /** 该周周一 */
    private LocalDate weekStart;
    private int created;
    private int completed;
}
