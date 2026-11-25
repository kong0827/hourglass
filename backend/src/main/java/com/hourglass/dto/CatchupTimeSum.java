package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 本周我在某个工作项上的计时汇总。 */
@Data
public class CatchupTimeSum {

    private String taskId;
    private Integer minutes;
    private Integer cnt;
    private LocalDateTime lastAt;
}
