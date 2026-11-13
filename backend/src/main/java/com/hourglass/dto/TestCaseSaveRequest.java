package com.hourglass.dto;

import lombok.Data;

import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.util.List;

/** 新建 / 保存测试用例 */
@Data
public class TestCaseSaveRequest {

    @NotBlank(message = "请选择所属项目")
    @Size(max = 32, message = "所属项目不合法")
    private String reqId;

    /** 关联需求（选填，须为同一项目下的需求池条目） */
    @Size(max = 32, message = "关联需求不合法")
    private String demandId;

    @NotBlank(message = "用例标题不能为空")
    @Size(max = 100, message = "标题最多 100 字")
    private String title;

    @Size(max = 1000, message = "前置条件最多 1000 字")
    private String precondition;

    @Size(max = 1000, message = "测试数据最多 1000 字")
    private String testData;

    @Size(max = 50, message = "功能模块最多 50 字")
    private String module;

    @Pattern(regexp = "P0|P1|P2|P3", message = "优先级不合法")
    private String priority;

    @Valid
    @Size(max = 30, message = "步骤最多 30 条")
    private List<StepItem> steps;

    @Data
    public static class StepItem {
        @Size(max = 200, message = "单条操作步骤最多 200 字")
        private String action;
        @Size(max = 500, message = "单条预期结果最多 500 字")
        private String expected;
    }
}
