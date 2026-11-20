package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.time.LocalDate;

/** 新建 / 保存测试计划 */
@Data
public class TestPlanSaveRequest {

    @NotBlank(message = "请选择所属项目")
    @Size(max = 32)
    private String reqId;

    @NotBlank(message = "计划名称不能为空")
    @Size(max = 100, message = "计划名称最多 100 字")
    private String name;

    @Size(max = 32)
    private String versionId;

    private LocalDate plannedStart;
    private LocalDate plannedEnd;

    @Pattern(regexp = "^(draft|running|done)$", message = "计划状态不合法")
    private String status;

    @Size(max = 500, message = "说明最多 500 字")
    private String note;

    /** 执行人账号ID；空表示不指派（不进任何人的「待我执行」） */
    @Size(max = 32)
    private String executorUserId;
}
