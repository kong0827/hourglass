package com.hourglass.dto;

import lombok.Data;
import lombok.EqualsAndHashCode;
import javax.validation.constraints.*;

@Data
@EqualsAndHashCode(callSuper = true)
public class ReleaseConfirmRequest extends ReleasePreviewRequest {
    @NotBlank(message = "请填写发布结果 result")
    @Pattern(regexp = "success|failed", message = "发布结果只能是 success/failed")
    private String result;
    @Size(max = 2000, message = "发布说明不能超过 2000 字")
    private String notes;
    @Size(max = 1000, message = "失败原因不能超过 1000 字")
    private String failureReason;
    @NotBlank(message = "请填写幂等键 idempotencyKey")
    @Size(max = 64, message = "幂等键不能超过 64 字符")
    private String idempotencyKey;
    private Long planRevision;
    @NotBlank(message = "请携带 release-preview 返回的 scopeToken")
    @Pattern(regexp = "[a-f0-9]{64}", message = "scopeToken 不合法，请使用 release-preview 返回的值")
    private String scopeToken;
}
