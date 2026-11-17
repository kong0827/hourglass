package com.hourglass.dto;

import lombok.Data;

@Data
public class ReqProgress {

    private String id;
    /** 所属项目集（空=未分组） */
    private String setId;
    private String setName;
    /** 容器项目标记：split_container=拆分后的公共容器 */
    private String containerKind;
    private String name;
    private String description;
    private String objective;
    private String status;
    /** 项目负责人（sql/50） */
    private String ownerUserId;
    /** 负责人显示名（列表联查填充；未设置时为空） */
    private String ownerName;
    private java.time.LocalDate plannedStart;
    private java.time.LocalDate plannedEnd;
    private java.time.LocalDateTime archivedAt;
    /** 首版上线日（null = 尚未标记；阶段视图项目切换用） */
    private java.time.LocalDate firstReleasedAt;
    /** 任务平均进度 0-100 */
    private int progressPct;
    private int taskCount;
    private int doneCount;
    /** 首版投入工时（分钟）：计时日 &lt;= 首版上线日，未标记上线时全部计入首版 */
    private int mvpWorkMinutes;
    /** 迭代投入工时（分钟）：计时日 &gt; 首版上线日 */
    private int postWorkMinutes;
    /** 准时完成率 0-100；没有带截止日期的已完成工作项时为 null */
    private Integer onTimePct;
    /** 该项目下的需求文档数（删除项目会连带删除，确认框据此提示） */
    private int docCount;
    /** 该项目下的版本数（删除项目会连带删除，确认框据此提示） */
    private int versionCount;
    /** 该项目下的需求池记录数（删除项目会连带删除，确认框据此提示） */
    private int demandCount;
    private java.time.LocalDateTime createdAt;
    private java.time.LocalDateTime updatedAt;
    /** 当前用户对该项目的写权限：read=只读，write=可编辑；前端据此收敛写入口 */
    private String access;
}
