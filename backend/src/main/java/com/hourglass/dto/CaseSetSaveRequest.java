package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

/** 新建 / 编辑用例集 */
@Data
public class CaseSetSaveRequest {

    /** 新建时必填；编辑时忽略（分组不跨项目移动） */
    private String reqId;

    @NotBlank(message = "请填写分组名称")
    @Size(max = 60, message = "分组名称最多 60 字")
    private String name;

    @Size(max = 200, message = "用途说明最多 200 字")
    private String note;

    @Pattern(regexp = "^(team|members|personal)$", message = "可见范围只允许 team / members / personal")
    private String visibility = "team";

    @Pattern(regexp = "^(manual|dynamic)$", message = "分组类型只允许 manual / dynamic")
    private String kind = "manual";

    /** kind=dynamic 时必填：收录规则（白名单字段），服务层归一后存 rule_json */
    private Rule rule;

    /** visibility=members 时的可见成员账号ID（≤50）；其他可见范围忽略 */
    private java.util.List<String> memberIds;

    /** 动态分组收录规则：与用例筛选同口径的白名单子集，另加回归集谓词 */
    @Data
    public static class Rule {
        private String status;
        private String pri;
        private String moduleId;
        private boolean moduleSub;
        private String demandId;
        private String owner;
        private boolean bugOnly;
        @Size(max = 100, message = "规则关键词最多 100 字")
        private String q;
        private boolean searchWide;
        /** 回归集：最近失败 / 阻塞，或关联缺陷仍未关闭 */
        private boolean regression;
    }
}