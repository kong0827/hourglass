package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;

@Data
public class TaskMoveRequest {

    @NotBlank(message = "目标列不能为空")
    @Pattern(regexp = "^[A-Za-z0-9_-]{1,24}$", message = "目标列不合法")
    private String column;

    /** 移到该任务之前；为空表示移到列尾 */
    private String beforeId;

    /**
     * 是否在移入「进行中」时自动开始计时。
     * 不传 = 自动（拖拽、键盘移列等"主动开工"的操作）；
     * 传 false = 不自动（例如"取消完成"回退到进行中，用户只是在纠正状态）。
     */
    private Boolean autoTimer;

    /**
     * 移到「已完成」后是否自动接力同列下一个任务开始计时。
     * 不传 = 自动（拖拽/勾选完成沿用既有行为）；
     * 批量移动传 false，避免批量整理数据时突然给别人或自己开表。
     */
    private Boolean autoResume;
}
