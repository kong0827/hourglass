package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 本周我在某项目某天的计时合计。 */
@Data
public class CatchupTimeCell {

    private String reqId;
    private String reqName;
    private LocalDate day;
    private Integer minutes;
}
