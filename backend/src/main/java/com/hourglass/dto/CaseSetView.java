package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 用例集列表行：带成员数与当前用户是否可改（个人分组只有本人可改） */
@Data
public class CaseSetView {

    private String id;
    private String reqId;
    private String name;
    private String note;
    private String visibility;
    private String ownerUserId;
    /** manual / dynamic */
    private String kind;
    /** 动态分组收录规则 JSON（manual 为 null），前端据此渲染规则 chip */
    private String ruleJson;
    /** visibility=members 时的可见成员账号ID列表 */
    private java.util.List<String> memberIds = new java.util.ArrayList<String>();
    private String createdBy;
    /** 收窄团队分组可见范围只允许创建人，前端据此提前禁用而不是等保存报错 */
    private String createdByUserId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private int caseCount;
    private boolean editable;
}