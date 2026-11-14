package com.hourglass.dto;

import lombok.Data;

/**
 * 分支卡上的「影响版本」标签：由 task.branch_id × version_task 推导得出，无独立绑定存储。
 * 分支是空间级的、版本是项目级的，同一分支名下可能聚合多个项目的同名版本，
 * 所以带上 reqId/reqName 供前端区分展示。
 */
@Data
public class BranchVersionTag {

    private String branchId;
    private String versionId;
    private String name;
    /** planned / active / released */
    private String status;
    private String reqId;
    private String reqName;
    /** 当前筛选范围内引用该版本的分支数（版本筛选下拉用） */
    private Integer count;
}
