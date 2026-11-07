package com.hourglass.dto;

import lombok.Data;

/** 项目用例执行概览：按最近一轮结果统计 */
@Data
public class CaseStatsView {

    private int total;
    private int passed;
    private int failed;
    private int blocked;
    private int untested;
}
