package com.hourglass.dto;

import lombok.Data;

import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.Size;
import java.util.List;

/** 把勾选的用例草稿创建成正式用例 */
@Data
public class AiCaseApplyRequest {

    @NotBlank(message = "请选择所属项目")
    @Size(max = 32, message = "所属项目不合法")
    private String reqId;

    /** 关联需求（选填，须为同一项目下） */
    @Size(max = 32, message = "关联需求不合法")
    private String demandId;

    @Valid
    @NotEmpty(message = "没有选中的用例")
    @Size(max = 12, message = "每次最多创建 12 条用例")
    private List<AiCaseDraft> cases;
}
