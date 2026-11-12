package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 报表下钻口径：kind 决定其余字段的用法，SQL 与页面聚合保持同一套条件。 */
@Data
public class TaskDrillQuery {

    /** created / completed / category / owner / column / priority */
    private String kind;
    private LocalDate from;
    private LocalDate before;
    /** 模块名（未指定为空白）、负责人名（未指定为空白）、列 ID 或优先级 */
    private String value;
}
