package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.util.List;

/** 列表页批量改列：统一走 move 语义（写移动日志、处理完成归档） */
@Data
public class TaskBulkMoveRequest {

    @NotEmpty(message = "请选择要移动的任务")
    @Size(max = 500, message = "一次最多移动 500 项")
    private List<String> ids;

    @NotBlank(message = "目标列不能为空")
    @Pattern(regexp = "^[A-Za-z0-9_-]{1,16}$", message = "目标列不合法")
    private String column;

    /** 批量整理默认不开始计时 */
    private Boolean autoTimer;

    /** 批量完成默认不接力计时 */
    private Boolean autoResume;
}
