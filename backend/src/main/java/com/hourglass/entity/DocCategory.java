package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 文档分类树节点（单归属归类）。
 * req_id 空串 = 空间级分类（不归属任何项目），非空 = 项目级分类；
 * parent_id 空串 = 顶级。不限层级，同级同名唯一。文档通过 requirement_doc.category_id 挂在节点上。
 */
@Data
public class DocCategory {

    private String id;
    private String workspaceId;
    /** 所属项目 ID；空串 = 空间级 */
    private String reqId;
    /** 父分类 ID，空串 = 顶级 */
    private String parentId;
    private String name;
    private Integer sortOrder;
    private LocalDateTime createdAt;
}