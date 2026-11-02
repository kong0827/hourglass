package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 人工覆盖风险等级；healthOverride 为空表示恢复自动。 */
@Data
public class HealthOverrideRequest {

    @Pattern(regexp = "red|amber|green|", message = "风险覆盖值只能是 red/amber/green 或空")
    private String healthOverride;

    @Size(max = 200, message = "覆盖原因不能超过 200 字")
    private String healthNote;

    /** 默认 30 天，范围 1-365 */
    private Integer days;
}
