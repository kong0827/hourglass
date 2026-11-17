package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 项目集新建/编辑入参：只做归组，不改变任何项目权限。 */
@Data
public class ProjectSetSaveRequest {

    @NotBlank(message = "请填写项目集名称")
    @Size(max = 60, message = "项目集名称不能超过 60 字")
    private String name;

    @Size(max = 1000, message = "项目集说明不能超过 1000 字")
    private String description;

    @Size(max = 32, message = "项目集负责人不合法")
    private String ownerUserId;

    @Pattern(regexp = "active|done|hold", message = "项目集状态不合法")
    private String status = "active";

    private java.time.LocalDate plannedStart;
    private java.time.LocalDate plannedEnd;

    @Pattern(regexp = "^#([0-9a-fA-F]{6})$", message = "标识色不合法")
    private String color;

    /** 编辑时的乐观锁令牌；不传则保持旧客户端整表覆盖行为 */
    private java.time.LocalDateTime updatedAt;
}
