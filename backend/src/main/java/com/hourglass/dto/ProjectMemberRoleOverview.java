package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 项目花名册：可见且非查看者的成员 + 当前用户能否标注角色。 */
@Data
public class ProjectMemberRoleOverview {

    private List<ProjectMemberRoleView> members;
    private boolean canEditRole;
}
