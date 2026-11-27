package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.util.List;

/** 文档通知成员：按范围挑人，只投递站内/邮件，不修改正文。 */
@Data
public class ReqDocNotifyRequest {

    /** project 项目成员 / workspace 空间成员 / members 仅可见成员 / users 指定人 */
    @NotBlank(message = "请选择通知范围")
    @Pattern(regexp = "^(project|workspace|members|users)$", message = "通知范围不合法")
    private String scope;

    /** scope=users 时必填 1–50 人；其他范围忽略 */
    @Size(max = 50, message = "一次最多通知 50 人")
    private List<String> userIds;

    /** publish 发布后提醒 / update 更新后提醒；只影响文案 */
    private String event;

    /** 附言：最多 100 字，拼进通知正文 */
    private String note;
}
