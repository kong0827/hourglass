package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 助手整理出的待确认草稿；按 {@link #action} 区分动作，字段由服务端校验后才可确认执行。
 *
 * <p>动作：create_task（建工作项）/ create_demand（提需求）/ demand_action（需求状态流转）/
 * move_task（工作项列流转）。带 «展示» 注释的字段由服务端解析后回填，仅供卡片显示，
 * 确认时不接受客户端回传；选项列表 likewise 只来自服务端已校验的可见集合。
 */
@Data
public class AiAssistantDraft {

    /** create_task | create_demand | demand_action | move_task */
    private String action;

    /* ---- 创建类共用 ---- */
    private String title;
    private String description;
    private String reqId;
    private String priority;

    /* ---- create_task ---- */
    private String itemType;
    private LocalDate startDate;
    private LocalDate dueDate;
    private String severity;
    private String boardColumn;

    /* ---- create_demand ---- */
    private String itemKind;
    private String source;
    private LocalDate expectDate;
    private String acceptText;

    /* ---- demand_action ---- */
    private String demandId;
    /** pass | rej | plan | replan | unpass | unplan | cancel | restore | reopen */
    private String demandAction;
    private String note;
    private String versionId;
    private LocalDate plannedStart;
    private LocalDate plannedEnd;

    /* ---- move_task ---- */
    private String taskId;
    private String targetColumn;
    private String reason;

    /* ---- 展示：服务端解析回填，确认时不回传 ---- */
    private String projectName;
    private String demandTitle;
    private String demandStatus;
    private String demandStatusName;
    private String targetStatusName;
    private String actionName;
    private String taskTitle;
    private String currentColumn;
    private String currentColumnName;
    private String targetColumnName;
    private String versionName;
    /** 当前用户对该需求所在项目是否有排期/发布管理权 */
    private boolean canManage;

    /* ---- 卡片选项：只来自服务端已校验的可见集合 ---- */
    private List<AiAssistantOption> allowedActions = new ArrayList<AiAssistantOption>();
    private List<AiAssistantOption> columns = new ArrayList<AiAssistantOption>();
    private List<AiAssistantOption> versions = new ArrayList<AiAssistantOption>();
    private List<AiAssistantOption> demandCandidates = new ArrayList<AiAssistantOption>();
    private List<AiAssistantOption> taskCandidates = new ArrayList<AiAssistantOption>();
}