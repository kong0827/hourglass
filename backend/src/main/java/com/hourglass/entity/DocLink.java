package com.hourglass.entity;

import lombok.Data;

/** 文档间引用关系：保存正文时按 hgdoc:// 站内协议解析重建。 */
@Data
public class DocLink {
    private String workspaceId;
    private String fromDocId;
    private String toDocId;
    private String createdBy;
}
