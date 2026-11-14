package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;

@Data
public class TaskMoveRequest {

    @NotBlank(message = "目标列不能为空")
    @Pattern(regexp = "^[A-Za-z0-9_-]{1,16}$", message = "目标列不合法")
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

    /**
     * 移入「测试中」且没有测试负责人时，是否自动认领给操作者。
     * 不传 = 自动（拖拽/开始测试）；批量移动传 false，避免整批待测都记到操作者名下。
     */
    private Boolean autoClaim;

    /** 流转规则要求「需填原因」时必填；允许的流转传了也会写进移动日志 */
    private String reason;

    /** 空间主 / 管理员强制越过「禁止」规则；普通成员传了会被拒绝 */
    private Boolean force;
}
