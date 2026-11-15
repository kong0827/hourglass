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
    /** 分类默认可见范围：team / members / personal；仅新建文档时套用，不参与可见判定 */
    private String visibility;
    /** 分类默认指定成员账号 ID，逗号分隔（visibility=members 时有效） */
    private String memberIds;
    private Integer sortOrder;
    private LocalDateTime createdAt;
}