package com.hourglass.dto;

import lombok.Data;
import lombok.EqualsAndHashCode;
import javax.validation.constraints.*;

@Data
@EqualsAndHashCode(callSuper = true)
public class ReleaseConfirmRequest extends ReleasePreviewRequest {
    @NotBlank @Pattern(regexp = "success|failed")
    private String result;
    @Size(max = 2000)
    private String notes;
    @Size(max = 1000)
    private String failureReason;
    @NotBlank @Size(max = 64)
    private String idempotencyKey;
    private Long planRevision;
    @NotBlank @Pattern(regexp = "[a-f0-9]{64}")
    private String scopeToken;
}
