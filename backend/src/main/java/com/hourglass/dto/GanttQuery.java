package com.hourglass.dto;

import com.hourglass.common.Consts;
import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 甘特图 SQL 查询参数。
 *
 * 与看板 BoardQuery 的语义逐条对齐（q 命中标题/描述/备注/模块/项目名/标签/附件名；
 * due 的 over/today/soon 与 TaskCalc.dueKind 一致；focus = 逾期/今天到期 或 进行中的 P0）。
 * reqs 里的 __none 拆成 reqNone 标记，避免在 XML 里做列表 contains 判断。
 */
@Data
public class GanttQuery {

    private String q;
    private List<String> owners = new ArrayList<String>();
    /** 测试负责人显示名快照，__none 表示待领取 */
    private List<String> testOwners = new ArrayList<String>();
    private List<String> pris = new ArrayList<String>();
    private List<String> cats = new ArrayList<String>();
    private List<String> tags = new ArrayList<String>();
    /** 工作项类型列表（story/task/bug/epic） */
    private List<String> types = new ArrayList<String>();
    /** 看板列（状态）ID 列表 */
    private List<String> columns = new ArrayList<String>();
    /** 完成情况：null=全部，open=未完成，done=已完成 */
    private String completion;
    /** 非 __none 的影响版本ID */
    private List<String> versionIds = new ArrayList<String>();
    /** 是否包含「待规划」（未绑定版本） */
    private boolean versionNone;
    /** 非 __none 的项目ID */
    private List<String> reqIds = new ArrayList<String>();
    /** 是否包含「未归类」项目 */
    private boolean reqNone;
    /** over / today / soon */
    private String due;
    private boolean focus;
    private boolean blocked;
    private boolean noDue;
    /** 截止日期区间（含端点），null 表示不限 */
    private LocalDate dueFrom;
    private LocalDate dueTo;
    /** 开始日期区间（含端点），null 表示不限 */
    private LocalDate startFrom;
    private LocalDate startTo;
    private boolean includeDone = true;
    private LocalDate today;
    private LocalDate from;
    private LocalDate to;
    /** 项目可见范围过滤：null 表示不过滤（owner/admin/viewer / 公开分享） */
    private String viewerId;

    /**
     * 搜索词里的工作项编号（WI-001 / wi1 / 纯数字）。
     * ganttWhere 是看板与甘特共用的片段，两边都要给出这个口径，否则 OGNL 取不到属性直接报错。
     */
    public Integer getItemNo() { return com.hourglass.common.Nos.parseWorkItem(q); }

    public static GanttQuery from(BoardQuery b, LocalDate today, LocalDate from, LocalDate to,
                                  boolean includeDone) {
        GanttQuery q = new GanttQuery();
        q.q = b.getQ();
        q.owners = new ArrayList<String>(b.getOwners());
        q.testOwners = new ArrayList<String>(b.getTestOwners());
        q.pris = new ArrayList<String>(b.getPris());
        q.cats = new ArrayList<String>(b.getCats());
        q.tags = new ArrayList<String>(b.getTags());
        q.types = new ArrayList<String>(b.getTypes());
        q.columns = new ArrayList<String>(b.getColumns());
        q.completion = b.getCompletion();
        for (String version : b.getVersions()) {
            if (Consts.REQ_NONE.equals(version)) {
                q.versionNone = true;
            } else {
                q.versionIds.add(version);
            }
        }
        for (String req : b.getReqs()) {
            if (Consts.REQ_NONE.equals(req)) {
                q.reqNone = true;
            } else {
                q.reqIds.add(req);
            }
        }
        q.due = b.getDue();
        q.focus = b.isFocus();
        q.blocked = b.isBlocked();
        q.noDue = b.isNoDue();
        q.dueFrom = b.getDueFrom();
        q.dueTo = b.getDueTo();
        q.startFrom = b.getStartFrom();
        q.startTo = b.getStartTo();
        q.includeDone = includeDone;
        q.today = today;
        q.from = from;
        q.to = to;
        return q;
    }
}
