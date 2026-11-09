package com.hourglass.dto;

import lombok.Data;
import javax.validation.constraints.*;
import java.time.OffsetDateTime;
import java.util.List;

@Data
public class ReleasePreviewRequest {
    @Size(max = 32)
    private String planId;
    @NotNull
    private OffsetDateTime occurredAt;
    @NotBlank @Pattern(regexp = "production|staging|test")
    private String environment;
    @NotNull @Size(max = 500)
    private List<@NotBlank @Size(max = 128) String> targetKeys;
    @NotBlank @Pattern(regexp = "full|partial|unknown")
    private String coverage;
    @NotBlank @Size(max = 500)
    private String artifactRef;
    @NotBlank @Pattern(regexp = "[a-fA-F0-9]{64}")
    private String artifactDigest;
    @NotBlank @Pattern(regexp = "deploy|redeploy|rollback")
    private String operation;
    @Size(max = 32)
    private String relatedReleaseId;
    @NotNull @Size(max = 500)
    private List<@NotBlank @Size(max = 32) String> actualTaskIds;
    @NotBlank @Size(max = 32)
    private String executorUserId;
    @Size(max = 1000)
    private String deviationReason;
}
