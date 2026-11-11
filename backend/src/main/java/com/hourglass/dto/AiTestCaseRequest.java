package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** AI 生成测试用例的来源：项目下的一份文档，或需求池里的一条需求 */
@Data
public class AiTestCaseRequest {

    /** doc = 需求文档；demand = 需求池条目 */
    @NotBlank(message = "请选择生成来源")
    @Pattern(regexp = "doc|demand", message = "生成来源不合法")
    private String source;

    @NotBlank(message = "请选择要生成用例的文档或需求")
    @Size(max = 32, message = "来源对象不合法")
    private String sourceId;

    /** 期望生成的条数，服务端会收口到 3–12 条 */
    private Integer maxCases;
}
