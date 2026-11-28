package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 本地账号与企微成员的绑定；唯一键是 (corpId, wecomUserid)，同一人可在多家企业各有一条。 */
@Data
public class WeComUserBind {

    private String id;
    private String userId;
    private String corpId;
    /** 统一小写 */
    private String wecomUserid;
    /** admin/self */
    private String bindSource;
    /** active/disabled */
    private String status;
    private String boundBy;
    private LocalDateTime boundAt;
    private LocalDateTime lastLoginAt;
}