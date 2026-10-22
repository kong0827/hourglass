package com.devstudio.kanban.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 需求列表项：不带完整正文，只给纯文本摘要 + 项目名 + 关联任务数 */
@Data
public class ReqDocView {

    private String id;
    private String reqId;
    /** 所属项目名 */
    private String reqName;
    private String title;
    private String status;
    private String owner;
    /** 正文纯文本摘要（服务端从 HTML 抽出来，最长 80 字） */
    private String excerpt;
    private Integer taskCount;
    private Integer doneCount;
    private LocalDateTime updatedAt;
    /** 创建时间（列表里展示「谁在什么时候建的」） */
    private LocalDateTime createdAt;

    /** 仅用于 SQL 取正文片段，服务层转成 excerpt 后置空，不返回给前端 */
    private transient String contentBrief;
}
