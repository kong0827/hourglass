package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/**
 * 人工判定请求。decision 为空/空串 = 撤销人工判定，立即按远程事实重算。
 * 取消与忽略必须填理由（服务端强校验 ≤32 字）。
 */
@Data
public class BranchOutcomeRequest {

    @Pattern(regexp = "done|canceled|ignored|", message = "人工判定只能是 done / canceled / ignored")
    private String decision;

    @Size(max = 32, message = "理由不能超过 32 字")
    private String reason;

    @Size(max = 200, message = "备注不能超过 200 字")
    private String note;
}
