package com.hourglass.dto;

import lombok.Data;

/** 添加成员时的候选账号：只暴露选人所需字段 */
@Data
public class MemberCandidate {

    private String id;
    private String username;
    private String displayName;
}
