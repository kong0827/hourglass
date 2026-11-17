package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 替他人添加/移除需求提醒人：只传账号 ID，成员与项目可见性由服务层校验。 */
@Data
public class DemandWatcherRequest {

    @NotBlank(message = "请选择提醒人")
    @Size(max = 32, message = "成员不合法")
    private String userId;
}
