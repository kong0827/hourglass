package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 分支状态变更请求。note 是随这次变更写进时间线的说明（如「测试环境已部署」）。 */
@Data
public class BranchStatusRequest {

    @NotBlank(message = "请选择分支状态")
    @Pattern(regexp = "dev|testing|merging|released", message = "分支状态不合法")
    private String status;

    @Size(max = 80, message = "状态说明不能超过 80 字")
    private String note;
}
