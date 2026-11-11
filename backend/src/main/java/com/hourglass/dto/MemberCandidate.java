package com.hourglass.dto;

import lombok.Data;

/** 添加成员时的候选账号：只暴露选人所需字段 */
@Data
public class MemberCandidate {

    private String id;
    private String username;
    private String displayName;
    /** 是否已经在当前空间内：搜索结果里保留自己/同事的账号信息，但不能重复添加 */
    private Boolean inWorkspace;
}
