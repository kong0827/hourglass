package com.hourglass.dto;

import com.hourglass.entity.Attachment;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/** 用例执行历史一行：结果/备注/执行人 + 失败证据附件。 */
@Data
public class CaseRunView {

    private String id;
    private String status;
    private String note;
    private String environment;
    private String bugTaskId;
    private String executedBy;
    private LocalDateTime createdAt;
    /** 逐步执行结果（逐步勾选时返回，供历史回看每步通过/失败/阻塞） */
    private List<CaseRunStepResult> stepResults;
    private List<Attachment> attachments;
}
