package com.hourglass.dto;

import lombok.Data;

/** 模块目录节点：树形归类（单归属），caseCount 只统计直接挂载在本节点的用例 */
@Data
public class CaseModuleNode {

    private String id;
    private String parentId;
    private String name;
    /** 1 = 顶级，不限层级 */
    private int level;
    private int sortOrder;
    private int caseCount;
    /** 含子节点的用例数（目录树展示用） */
    private int subtreeCount;
}