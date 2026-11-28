package com.hourglass.dto;

import com.hourglass.entity.ApiToken;
import com.hourglass.entity.AppUser;
import lombok.AllArgsConstructor;
import lombok.Getter;

/** 令牌鉴权结果：令牌行 + 令牌所属账号 */
@Getter
@AllArgsConstructor
public class ApiTokenAuth {

    private final ApiToken token;
    private final AppUser user;
}