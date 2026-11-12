package com.hourglass.dto;

import lombok.Data;

/**
 * 分支列表查询条件。status 为空表示不限状态；counts 统计时会忽略 status，
 * 因此服务层会复制一份把 status 置空再查。
 */
@Data
public class BranchQuery {

    private String workspaceId;
    /** 非空时按项目可见范围过滤（owner/admin/viewer 为空） */
    private String viewerId;
    /** 直接归属该项目的分支 + 归属于该项目（或尚未关联任务）的公共分支 */
    private String projectId;
    private String status;
    /** 非空时按负责人账号过滤（owner_user_id）；负责人手填姓名的分支不在此列，用关键词搜 */
    private String ownerUserId;
    /** 名称/目标分支/负责人/影响版本/归属项目 模糊搜索 */
    private String q;
    private int offset;
    private int limit = 50;
}
