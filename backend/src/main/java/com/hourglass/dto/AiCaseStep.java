package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Size;

/** AI 生成用例中的一条执行步骤 */
@Data
public class AiCaseStep {

    @Size(max = 200, message = "单条操作步骤最多 200 字")
    private String action;

    @Size(max = 500, message = "单条预期结果最多 500 字")
    private String expected;
}
