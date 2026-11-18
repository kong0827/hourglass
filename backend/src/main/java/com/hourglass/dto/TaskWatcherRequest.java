package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 替他人关注工作项：只传账号 ID，成员与项目可见性由服务层校验。 */
@Data
public class TaskWatcherRequest {

    @NotBlank(message = "请选择关注人")
    @Size(max = 32, message = "成员不合法")
    private String userId;
}
