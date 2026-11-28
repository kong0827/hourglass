package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 跨项目版本清单：可见项目下的版本、工作项数、需求覆盖、下一计划与管理权限。 */
@Data
public class CrossProjectVersionRow {
    private String reqId;
    private String projectName;
    private String versionId;
    private String versionName;
    private String versionStatus;
    private LocalDate startDate;
    private LocalDate targetDate;
    private LocalDateTime releasedAt;
    private LocalDateTime updatedAt;
    /** 项目负责人显示名：版本本身没有负责人字段，列表沿用所属项目负责人。 */
    private String ownerName;
    private Integer taskCount;
    /** 同口径已完成工作项数（board_column='done'），计划向导按版本显示「已完成/总数」。 */
    private Integer doneTaskCount;
    /** 未完成且没估时的工作项数：用来生成「N 项工作项未估时」待办。 */
    private Integer unestimatedTaskCount;
    /** 未关闭/未驳回/未取消的目标需求数，与需求覆盖分母同口径。 */
    private Integer demandCount;
    /** 至少有一条用例的需求数，与发布检查的需求级覆盖同口径。 */
    private Integer coveredDemandCount;
    private LocalDateTime nextPlanAt;
    private String nextPlanEnvironment;
    private String nextPlanStatus;
    private Integer productionSuccessCount;
    private Integer stagingSuccessCount;
    private LocalDate latestReleaseDate;
    /** 交付说明四个对外表述（摘要/变更/缺陷/验收）全部确认过：列表只用它决定是否露「交付说明已确认」。 */
    private Boolean deliveryConfirmed;
    private Boolean canManage;
    /** 系统自动汇总的待办条数：前端只展示数量，明细仍进版本详情。 */
    private Integer todoCount;
}
