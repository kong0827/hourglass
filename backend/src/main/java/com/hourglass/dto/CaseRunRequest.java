package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 记录一次用例执行结果 */
@Data
public class CaseRunRequest {

    @NotBlank(message = "请选择执行结果")
    @Pattern(regexp = "^(passed|failed|blocked|skipped)$", message = "执行结果不合法")
    private String status;

    @Size(max = 500, message = "备注最多 500 字")
    private String note;

    @Size(max = 120, message = "执行环境最多 120 字")
    private String environment;

    /** 代录执行人（app_user.id）；空 = 当前登录人 */
    private String executedByUserId;
}
