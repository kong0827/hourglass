package com.hourglass.dto;

import lombok.Data;

/** 阅读页「引用 / 被引用」列表条目：只含当前用户可见的目标文档。 */
@Data
public class DocLinkView {
    private String docId;
    private String title;
    private String status;
    private String format;
    private java.time.LocalDateTime updatedAt;
}
