package com.devstudio.kanban.dto;

import com.devstudio.kanban.common.Consts;
import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 甘特图 SQL 查询参数。
 *
 * 与看板 BoardQuery 的语义逐条对齐（q 命中标题/描述/备注/分类/项目名/标签/附件名；
 * due 的 over/today/soon 与 TaskCalc.dueKind 一致；focus = 逾期/今天到期 或 进行中的 P0）。
 * reqs 里的 __none 拆成 reqNone 标记，避免在 XML 里做列表 contains 判断。
 */
@Data
public class GanttQuery {

    private String q;
    private List<String> owners = new ArrayList<String>();
    private List<String> pris = new ArrayList<String>();
    private List<String> cats = new ArrayList<String>();
    private List<String> tags = new ArrayList<String>();
    /** 非 __none 的项目ID */
    private List<String> reqIds = new ArrayList<String>();
    /** 是否包含「未归类」项目 */
    private boolean reqNone;
    /** over / today / soon */
    private String due;
    private boolean focus;
    private boolean blocked;
    private boolean noDue;
    private boolean includeDone = true;
    private LocalDate today;
    private LocalDate from;
    private LocalDate to;

    public static GanttQuery from(BoardQuery b, LocalDate today, LocalDate from, LocalDate to,
                                  boolean includeDone) {
        GanttQuery q = new GanttQuery();
        q.q = b.getQ();
        q.owners = new ArrayList<String>(b.getOwners());
        q.pris = new ArrayList<String>(b.getPris());
        q.cats = new ArrayList<String>(b.getCats());
        q.tags = new ArrayList<String>(b.getTags());
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
        q.includeDone = includeDone;
        q.today = today;
        q.from = from;
        q.to = to;
        return q;
    }
}
