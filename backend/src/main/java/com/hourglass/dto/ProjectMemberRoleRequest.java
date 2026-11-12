package com.hourglass.dto;

import lombok.Data;

/** 保存项目职能覆盖；空主职能回退到空间默认，且无兼岗时删除覆盖行。 */
@Data
public class ProjectMemberRoleRequest {

    private String roleTitle;
    /** null（未提供）保持既有兼岗；空数组清除。 */
    private java.util.List<String> secondaryRoleTitles;
}
