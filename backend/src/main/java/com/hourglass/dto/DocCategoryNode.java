package com.hourglass.dto;

import lombok.Data;

/**
 * 文档分类树节点：DFS 顺序的扁平列表，带层级。
 * reqId 空串 = 空间级分类；前端按 reqId 分组到「项目 / 空间文档」两棵树。
 * 文档计数（docCount/subtreeCount）由前端从已加载的可见文档列表按 categoryId 统计，
 * 与列表草稿可见口径天然一致，故此处不重复计数。
 */
@Data
public class DocCategoryNode {

    private String id;
    /** 所属项目 ID；空串 = 空间级 */
    private String reqId;
    private String parentId;
    private String name;
    /** 1 = 顶级，不限层级 */
    private int level;
    private int sortOrder;
    /** 分类默认可见范围（team / members / personal）：仅新建文档时套用，不改变已有文档 */
    private String visibility;
    /** 默认名单人数；team / personal 恒为 0 */
    private int memberCount;
    /** 默认名单：只有对该范围可写的人回传，其他人只给人数 */
    private java.util.List<String> memberIds;
}