package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;
import java.time.LocalDate;

/** 需求提交前体检：只读，不落库；字段口径与 DemandSaveRequest 一致 */
@Data
public class DemandCheckRequest {

    @NotBlank(message = "请选择所属项目")
    @Size(max = 32, message = "所属项目ID不合法")
    private String reqId;

    @NotBlank(message = "请填写需求标题")
    @Size(max = 80, message = "需求标题不能超过 80 字")
    private String title;

    @Size(max = 2000, message = "需求描述不能超过 2000 字")
    private String description;

    @Size(max = 2000, message = "验收标准不能超过 2000 字")
    private String acceptText;

    /** 用于判断「P0/P1 缺期望交付」；不合法时按未填处理，不在体检里报错 */
    private String priority;

    private LocalDate expectDate;

    /** 编辑时排除自身，避免把自己标成相似需求 */
    @Size(max = 32, message = "需求ID不合法")
    private String excludeId;
}
