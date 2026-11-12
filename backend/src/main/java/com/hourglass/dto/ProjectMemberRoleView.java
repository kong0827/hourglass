package com.hourglass.dto;

import lombok.Data;

/**
 * 项目花名册的一行：成员身份 + 公司 + 本项目角色 + 有效权限 + 可见来源。
 * roleTitle/companyName 只用于展示，不参与鉴权。
 */
@Data
public class ProjectMemberRoleView {

    private String userId;
    private String displayName;
    private String username;
    private String companyName;
    /** 项目覆盖原值；没有覆盖行为 null，不能回填空间默认。 */
    private String roleTitle;
    private String jobTitle;
    private String effectiveRoleTitle;
    /** project / workspace / unset */
    private String roleSource;
    private java.util.List<String> secondaryRoleTitles = java.util.Collections.emptyList();
    /** write / read */
    private String access;
    /** 项目负责人 / 空间主 / 空间管理员 / 空间默认参与 / 项目授权 */
    private String source;
    private boolean canEditRole;
}
