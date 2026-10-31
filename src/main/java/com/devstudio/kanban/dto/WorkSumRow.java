package com.devstudio.kanban.dto;

import lombok.Data;

/** 工时合计：区间内 / 累计，全空间 / 我 */
@Data
public class WorkSumRow {

    private int totalAll;
    private int weekAll;
    private int totalMine;
    private int weekMine;
}
