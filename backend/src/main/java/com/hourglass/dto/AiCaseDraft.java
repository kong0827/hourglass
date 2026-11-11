package com.hourglass.dto;

import lombok.Data;

import javax.validation.Valid;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.util.ArrayList;
import java.util.List;

/** AI 生成的一条测试用例草稿：先给用户勾选和修改，确认后才落库 */
@Data
public class AiCaseDraft {

    @Size(max = 100, message = "用例标题最多 100 字")
    private String title;

    @Size(max = 1000, message = "前置条件最多 1000 字")
    private String precondition;

    @Size(max = 50, message = "功能模块最多 50 字")
    private String module;

    @Pattern(regexp = "P0|P1|P2|P3", message = "优先级不合法")
    private String priority;

    @Valid
    @Size(max = 30, message = "步骤最多 30 条")
    private List<AiCaseStep> steps = new ArrayList<AiCaseStep>();

    /** 为什么生成这条用例（引用来源里的哪段要求），便于用户判断是否保留 */
    @Size(max = 200, message = "生成理由最多 200 字")
    private String reason;
}
