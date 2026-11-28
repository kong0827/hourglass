package com.hourglass.wecom;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 平台管理员登记/修改一个企业微信企业；更新时 corpSecret 留空表示不改。 */
@Data
public class WeComCorpRequest {

    @NotBlank(message = "请填写企业 CorpID")
    @Pattern(regexp = "^[A-Za-z0-9_-]{6,64}$", message = "CorpID 只能包含字母、数字、下划线与中划线（6–64 位）")
    private String corpId;

    @NotBlank(message = "请填写企业名称")
    @Size(max = 64, message = "企业名称最多 64 个字符")
    private String corpName;

    @NotBlank(message = "请填写应用 AgentId")
    @Pattern(regexp = "^[0-9]{1,12}$", message = "AgentId 必须是数字")
    private String agentId;

    /** 应用 Secret；新建必填，修改留空表示保持原值 */
    private String corpSecret;

    @NotBlank(message = "请填写回调根地址")
    @Size(max = 255, message = "回调根地址过长")
    private String callbackBaseUrl;

    @Size(max = 200, message = "备注最多 200 个字符")
    private String remark;
}