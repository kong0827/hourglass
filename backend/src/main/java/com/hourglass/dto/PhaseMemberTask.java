package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/**
 * 成员阶段工时下钻的一行：任务 × 阶段。
 * 同一任务在首版/迭代都有计时时会出现两行，保证合计与阶段卡 memberHours 一致。
 */
@Data
public class PhaseMemberTask {

    private String taskId;
    private String title;
    private String itemType;
    private String owner;
    private LocalDate startDate;
    private LocalDate dueDate;
    private Integer estimateMinutes;
    private String boardColumn;
    /** mvp / post */
    private String phase;
    private Integer minutes;
}
