package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Size;
import java.time.LocalDate;

/** 改期 / 取消 / 人工确认共用；按动作校验必填项 */
@Data
public class MilestoneActionRequest {

    private LocalDate targetDate;
    @Size(max = 500)
    private String reason;
    @Size(max = 500)
    private String note;
    /** 并发保护：必须携带当前 revision */
    private Long revision;
}
