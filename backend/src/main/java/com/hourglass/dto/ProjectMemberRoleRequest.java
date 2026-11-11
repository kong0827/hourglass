package com.hourglass.dto;

import lombok.Data;

/** 保存项目角色；空值表示清除该成员在此项目的角色标签。 */
@Data
public class ProjectMemberRoleRequest {

    private String roleTitle;
}
