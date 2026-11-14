package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 仓库绑定 / 编辑请求。token 留空表示不修改；clearToken=true 表示清除。 */
@Data
public class RepoSaveRequest {

    @Size(max = 32, message = "所属项目ID不合法")
    private String reqId;

    @Size(max = 80, message = "仓库名不能超过 80 字")
    private String name;

    @Size(max = 500, message = "仓库地址不能超过 500 字")
    private String repoUrl;

    @Size(max = 200, message = "GitLab 项目标识不能超过 200 字")
    private String projectRef;

    @Size(max = 80, message = "默认目标分支不能超过 80 字")
    private String defaultTarget;

    @Pattern(regexp = "recent90|all|manual|", message = "导入策略只能是 recent90 / all / manual")
    private String importPolicy;

    private Boolean syncEnabled;

    @Size(max = 500, message = "访问令牌过长")
    private String token;

    /** 显式清除已保存的令牌 */
    private Boolean clearToken;
}
