package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotNull;

/**
 * 修改自己的计时设置：只有工作时段内的计时才计入工时，且每天最多计入 maxHours 小时。
 * 开始 0-23、结束 1-24（24 表示到当天 24:00），且结束必须晚于开始；上限 1-24 小时。
 */
@Data
public class WorkHoursRequest {

    @NotNull(message = "请填写上班时间")
    @Min(value = 0, message = "上班时间需在 0-23 点之间")
    @Max(value = 23, message = "上班时间需在 0-23 点之间")
    private Integer startHour;

    @NotNull(message = "请填写下班时间")
    @Min(value = 1, message = "下班时间需在 1-24 点之间")
    @Max(value = 24, message = "下班时间需在 1-24 点之间")
    private Integer endHour;

    /** 每天最多计入几小时；不传按 8 */
    @Min(value = 1, message = "每天上限需在 1-24 小时之间")
    @Max(value = 24, message = "每天上限需在 1-24 小时之间")
    private Integer maxHours;
}
