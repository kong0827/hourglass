package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 用例集（自定义分组）：多归属，成员是引用不是复制；删除分组不删除用例。 */
@Data
public class CaseSet {

    private String id;
    private String workspaceId;
    private String reqId;
    /** 父分组ID；空串=顶级。子组继承父组可见范围 */
    private String parentId;
    /** 同级手动排序序号（小在前） */
    private Integer sortOrder;
    private String name;
    private String note;
    /** team = 团队共享（进交付说明与发布证据）；members = 指定成员可见；personal = 仅自己可见（后两者不进证据链） */
    private String visibility;
    /** manual = 手工挑选；dynamic = 按规则自动收录（成员由 ruleJson 派生，读取时自愈刷新） */
    private String kind;
    /** 动态分组收录规则（白名单字段 JSON）；manual 为 null */
    private String ruleJson;
    /** personal/members 时为创建人账号ID；team 为空串 */
    private String ownerUserId;
    /** 示例包标记：1=示例用例包（新手引导的合成数据，可整包级联删除，见 sql/139） */
    private Integer pack;
    private String createdBy;
    private String createdByUserId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}