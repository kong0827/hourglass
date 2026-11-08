package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.util.List;

/** 计划批量动作：圈选加入 / 批量录入执行结果 */
@Data
public class PlanBatchRequest {

    /** 用例 ID 集合（加入计划 / 批量执行都用它） */
    @NotEmpty(message = "请先勾选用例")
    private List<String> caseIds;

    /** 批量执行结果：passed/failed/blocked；加入计划时忽略 */
    @Pattern(regexp = "^(passed|failed|blocked)$", message = "执行结果不合法")
    private String status;

    @Size(max = 500, message = "备注最多 500 字")
    private String note;
}
