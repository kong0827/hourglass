package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 逐步执行结果一步：下标 + 结果 + 备注（执行弹框逐步勾选） */
@Data
public class CaseRunStepResult {

    /** 步骤下标（1 起，对应用例 steps 数组） */
    @Min(value = 1, message = "步骤下标必须从 1 开始")
    @Max(value = 30, message = "步骤下标超出上限")
    private int idx;

    @Pattern(regexp = "^(passed|failed|blocked)$", message = "步骤结果不合法")
    private String status;

    @Size(max = 200, message = "步骤备注最多 200 字")
    private String note;
}
