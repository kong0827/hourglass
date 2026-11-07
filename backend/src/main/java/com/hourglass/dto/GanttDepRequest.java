package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 新建 / 修改依赖 */
@Data
public class GanttDepRequest {

    @Size(max = 32, message = "前驱任务不合法")
    private String fromTaskId;

    @Size(max = 32, message = "后继任务不合法")
    private String toTaskId;

    @Pattern(regexp = "FS|SS|FF|SF", message = "依赖类型不合法")
    private String depType = "FS";

    @Min(value = -365, message = "滞后天数不能小于 -365")
    @Max(value = 365, message = "滞后天数不能大于 365")
    private Integer lagDays = 0;
}
