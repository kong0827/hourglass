package com.hourglass.dto;

import lombok.Data;
import javax.validation.constraints.*;
import java.time.OffsetDateTime;
import java.util.List;

@Data
public class ReleasePreviewRequest {
    @Size(max = 32, message = "发布计划ID不合法")
    private String planId;
    @NotNull(message = "请填写发布时间 occurredAt")
    private OffsetDateTime occurredAt;
    @NotBlank(message = "请填写发布环境 environment")
    @Pattern(regexp = "production|staging|test", message = "发布环境只能是 production/staging/test")
    private String environment;
    @NotNull(message = "请提供发布目标列表 targetKeys")
    @Size(max = 500, message = "发布目标最多 500 项")
    private List<@NotBlank(message = "发布目标不能为空") @Size(max = 128, message = "单个发布目标不能超过 128 字符") String> targetKeys;
    @NotBlank(message = "请填写覆盖范围 coverage")
    @Pattern(regexp = "full|partial|unknown", message = "覆盖范围只能是 full/partial/unknown")
    private String coverage;
    @NotBlank(message = "请填写制品标识 artifactRef")
    @Size(max = 500, message = "制品标识不能超过 500 字符")
    private String artifactRef;
    @NotBlank(message = "请填写制品摘要 artifactDigest")
    @Pattern(regexp = "[a-fA-F0-9]{64}", message = "制品摘要必须是 64 位十六进制 SHA-256")
    private String artifactDigest;
    @NotBlank(message = "请填写操作类型 operation")
    @Pattern(regexp = "deploy|redeploy|rollback", message = "操作类型只能是 deploy/redeploy/rollback")
    private String operation;
    @Size(max = 32, message = "关联发布ID不合法")
    private String relatedReleaseId;
    @NotNull(message = "请提供实际发布任务列表 actualTaskIds")
    @Size(max = 500, message = "实际发布任务最多 500 项")
    private List<@NotBlank(message = "实际发布任务ID不能为空") @Size(max = 32, message = "实际发布任务ID不合法") String> actualTaskIds;
    @NotBlank(message = "请填写执行人 executorUserId")
    @Size(max = 32, message = "执行人账号ID不合法")
    private String executorUserId;
    @Size(max = 1000, message = "偏差原因不能超过 1000 字")
    private String deviationReason;
}
