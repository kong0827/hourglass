package com.hourglass.dto;

import lombok.Data;

/**
 * 测试用例分页查询条件。
 */
@Data
public class CaseQuery {

    private String workspaceId;
    private String reqId;
    /** passed/failed/blocked/skipped/__untested，null = 全部 */
    private String status;
    /** 模块名 / __none */
    private String module;
    /** 优先级 / __none */
    private String pri;
    /** 最近执行人 */
    private String owner;
    /** 仅看关联缺陷仍有效未完成（未删除、未进入完成列）的用例 */
    private boolean bugOnly;
    private String q;
    private int offset;
    private int limit = 100;

    /** 搜索词里的用例编号（TC-001 / tc1 / 纯数字）；不是编号形态返回 null，走文本匹配 */
    public Integer getCaseNo() {
        return com.hourglass.common.Nos.parseCase(q);
    }
}
