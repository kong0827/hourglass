package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 持久化邮件 outbox；业务事务只负责写 pending，实际发送由定时扫描完成。 */
@Data
public class MailDelivery {

    private Long id;
    private String recipient;
    private String subject;
    private String body;
    private String eventType;
    private String referenceId;
    /** pending / sent / failed */
    private String status;
    private Integer attempts;
    private LocalDateTime nextAttemptAt;
    private String lastError;
    private LocalDateTime createdAt;
    private LocalDateTime sentAt;
}
