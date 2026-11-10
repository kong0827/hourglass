package com.hourglass.dto;

import lombok.Data;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.List;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.NotBlank;

@Data
public class ReleasePlanRequest {
    @Size(max = 32, message = "发布计划ID不合法")
    private String id;
    /** 计划覆盖的版本；省略时使用 URL 中的版本（更新时沿用原计划版本）。 */
    @Size(max = 50, message = "一个计划最多包含 50 个版本")
    private List<@NotBlank(message = "计划版本ID不能为空") @Size(max = 32, message = "计划版本ID不合法") String> versionIds;
    @NotNull(message = "请提供计划任务列表 plannedTaskIds")
    @Size(max = 500, message = "计划任务最多 500 项")
    private List<@NotBlank(message = "计划任务ID不能为空") @Size(max = 32, message = "计划任务ID不合法") String> plannedTaskIds;
    @NotBlank(message = "请填写发布环境 environment")
    @Pattern(regexp = "production|staging|test", message = "发布环境只能是 production/staging/test")
    private String environment;
    @NotNull(message = "请提供发布目标列表 targetKeys")
    @Size(max = 500, message = "发布目标最多 500 项")
    private List<@NotBlank(message = "发布目标不能为空") @Size(max = 128, message = "单个发布目标不能超过 128 字符") String> targetKeys;
    @NotBlank(message = "请填写覆盖范围 coverage")
    @Pattern(regexp = "full|partial|unknown", message = "覆盖范围只能是 full/partial/unknown")
    private String coverage;
    private LocalDateTime plannedAt;
    private String ownerUserId;
    @Size(max = 2000, message = "计划说明不能超过 2000 字")
    private String notes;
    @Size(max = 1000, message = "风险提示不能超过 1000 字")
    private String risks;
    @Pattern(regexp = "draft|ready|canceled", message = "计划状态只能是 draft/ready/canceled")
    private String status;
    private Long revision;
    @Size(max = 500, message = "变更原因不能超过 500 字")
    private String reason;
}
