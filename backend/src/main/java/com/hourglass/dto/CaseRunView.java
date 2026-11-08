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
    private String bugTaskId;
    private String executedBy;
    private LocalDateTime createdAt;
    private List<Attachment> attachments;
}
