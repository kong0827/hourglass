package com.hourglass.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/** 用例列表行：步骤已解析为结构化数组，最近执行结果与转出缺陷一并下发。 */
@Data
public class TestCaseView {

    private String id;
    private String reqId;
    private String demandId;
    private String demandTitle;
    /** 项目内稳定编号（TC-001），与列表序号无关 */
    private Integer caseNo;
    private String title;
    private String precondition;
    private String testData;
    private String module;
    /** 所属目录节点 ID；module 是节点名快照，路径由前端按目录树拼 */
    private String moduleId;
    private String priority;
    private List<Map<String, String>> steps;
    private String latestStatus;
    private String latestNote;
    private String latestBy;
    private LocalDateTime latestAt;
    private String latestBugTaskId;
    private String latestBugTaskTitle;
    /** 关联缺陷已修复关闭（未删除且 board_column=done）：最新执行仍失败时前端提示「待复测」 */
    private Boolean latestBugResolved;
    /** 验证的工作项（多对多）；空数组表示只到需求级覆盖 */
    private List<CaseTaskLink> tasks;
    /** 最近一轮执行挂载的证据附件数（失败截图等） */
    private Integer latestEvidenceCount;
    /** 创建人显示名：与最近执行人区分 */
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /** 库内原始 JSON（仅服务端解析用，不下发） */
    @JsonIgnore
    private String stepsJson;
}
