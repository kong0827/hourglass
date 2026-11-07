package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class MemberAddRequest {

    @NotBlank(message = "请填写要添加的用户登录名")
    @Size(max = 32, message = "登录名过长")
    private String username;
}
