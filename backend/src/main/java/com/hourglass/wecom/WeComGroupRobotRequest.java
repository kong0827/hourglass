package com.hourglass.wecom;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 空间主/管理员按企业添加群机器人；修改时 webhook 留空表示不换。 */
@Data
public class WeComGroupRobotRequest {

    @NotBlank(message = "请选择企业")
    @Size(max = 64, message = "CorpID 过长")
    private String corpId;

    @NotBlank(message = "请填写群名称")
    @Size(max = 64, message = "群名称最多 64 个字符")
    private String name;

    /** 群机器人 Webhook；新建必填，修改留空表示保持原值 */
    @Size(max = 1024, message = "Webhook 地址过长")
    private String webhook;

    /** active/disabled；不传按 active */
    private String status;
}