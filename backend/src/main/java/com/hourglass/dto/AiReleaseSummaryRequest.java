package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 发布摘要草稿：指定一份交付说明（版本或发布计划），只生成文字，不落库 */
@Data
public class AiReleaseSummaryRequest {

    /** version / plan */
    @NotBlank(message = "缺少摘要范围")
    @Size(max = 16, message = "摘要范围不合法")
    private String scopeType;

    @NotBlank(message = "缺少版本或计划 ID")
    @Size(max = 32, message = "对象 ID 过长")
    private String scopeId;

    /** 版本维度可选：指定某条发布记录作为依据 */
    @Size(max = 32, message = "发布记录 ID 过长")
    private String releaseId;

    /** plain / formal，默认 plain */
    @Size(max = 12, message = "语气参数过长")
    private String tone;
}
