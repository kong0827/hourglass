package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 创建个人访问令牌：必须校验当前密码，防止会话被劫持后静默铸造长期令牌 */
@Data
public class ApiTokenCreateRequest {

    @NotBlank(message = "请填写令牌名称")
    @Size(max = 64, message = "名称最多 64 位")
    private String name;

    /** read 或 write；不填默认 read。write 也只能调用写白名单内的接口 */
    private String scope;

    @Min(value = 1, message = "有效期至少 1 天")
    @Max(value = 3650, message = "有效期最多 3650 天")
    private Integer expiresInDays;

    @NotBlank(message = "请填写当前密码")
    private String password;
}