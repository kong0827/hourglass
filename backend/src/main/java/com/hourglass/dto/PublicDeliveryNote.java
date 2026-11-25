package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 接收人只读页：冻结载荷 + 分享约束；不含任何内部备注与编辑能力。 */
@Data
public class PublicDeliveryNote {

    private String workspaceName;
    private String docNo;
    private String title;
    private String tone;
    private String contentHash;
    private LocalDateTime createdAt;
    private LocalDateTime expiresAt;
    private Boolean allowDownload;
    /** true 时正文不下发，接收人需先输入访问密码 */
    private Boolean passwordRequired;
    /** 接收人页与打印时的水印文字 */
    private String watermarkText;
    private DeliveryNoteResponse note;
}