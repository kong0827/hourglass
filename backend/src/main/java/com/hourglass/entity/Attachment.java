package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class Attachment {

    private String id;
    /** 附件目标ID：task=任务ID，demand=需求池需求ID（sql/24 泛化） */
    private String targetId;
    /** 目标类型：task / demand */
    private String targetKind;
    private String workspaceId;
    private String filename;
    private String contentType;
    private Long size;
    private String storedName;
    private LocalDateTime createdAt;
}
