package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 发布计划维度交付说明的人工层：数字仍从计划覆盖的版本实时聚合。 */
@Data
public class DeliveryNotePlan {

    private String workspaceId;
    private String planId;
    private String audience;
    private String supportContact;
    private String options;
    private String narratives;
    private String confirmed;
    private String acceptance;
    private String updatedBy;
    private Long revision;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
