package com.hourglass.dto;

import lombok.Data;

/** 逐项确认 / 标记风险；expectedScopeToken 用于阻止范围变化后静默覆盖。 */
@Data
public class ReleasePrepCheckRequest {
    /** ok / risk */
    private String state;
    private String note;
    private String expectedScopeToken;
}
