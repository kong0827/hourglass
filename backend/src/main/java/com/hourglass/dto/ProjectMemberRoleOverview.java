package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 项目花名册：可见且非查看者的成员 + 当前用户能否标注角色。 */
@Data
public class ProjectMemberRoleOverview {

    private List<ProjectMemberRoleView> members;
    private boolean canEditRole;
    /** 项目负责人/空间管理员可为成员调整本项目的可见与测试权限 */
    private boolean canManageAccess;
}
