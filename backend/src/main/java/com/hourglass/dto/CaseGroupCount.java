package com.hourglass.dto;

import lombok.Data;

/** 分组段头：当前筛选范围内该分段的条数与执行结果分布（段内计数，不是全项目 facets） */
@Data
public class CaseGroupCount {

    /** 分段键：目录节点ID / 优先级 / 执行结果 / 执行人 / 需求ID / 用例集ID；空值类为 __none */
    private String key;
    private String label;
    private int total;
    private int passed;
    private int failed;
    private int blocked;
    private int skipped;
    private int untested;
}