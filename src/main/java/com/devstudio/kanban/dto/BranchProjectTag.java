package com.devstudio.kanban.dto;

import lombok.Data;

/**
 * 分支卡上的「归属项目」标签：由 task.branch_id × task.req_id 推导得出，无独立绑定存储。
 *
 * <p>分支是空间级的，但一条分支上的任务可能分散在多个项目里；这里只展示查看人可见的项目，
 * 作为分支与项目之间的弱关联，用于页面筛选与分组。</p>
 */
@Data
public class BranchProjectTag {

    private String branchId;
    private String projectId;
    private String projectName;
}
