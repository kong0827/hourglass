package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 看板/已完成列表查询条件
 */
@Data
public class BoardQuery {

    private String q;
    private List<String> owners = new ArrayList<String>();
    private List<String> pris = new ArrayList<String>();
    private List<String> cats = new ArrayList<String>();
    /** 需求ID列表，__none 表示未归类 */
    private List<String> reqs = new ArrayList<String>();
    /** 标签名列表（命中任意一个即匹配） */
    private List<String> tags = new ArrayList<String>();
    /** 工作项类型列表（story/task/bug/epic） */
    private List<String> types = new ArrayList<String>();
    /** 影响版本ID列表，__none 表示待规划 */
    private List<String> versions = new ArrayList<String>();
    /** over/today/soon */
    private String due;
    /** 今日聚焦：逾期 + 今天到期 + 进行中的 P0 */
    private boolean focus;
    /** 仅看被阻塞的任务（N-4） */
    private boolean blocked;
    /** 仅看没有截止日期的任务（O-25 日历「本月未排期」） */
    private boolean noDue;
    /** week/all */
    private String doneScope = "week";
    private int doneLimit = 20;
    private int doneOffset = 0;

    public static BoardQuery from(String q, String owners, String pris, String cats, String reqs, String tags,
                                  String due, Boolean focus, String doneScope, Integer doneLimit, Integer doneOffset) {
        return from(q, owners, pris, cats, reqs, tags, null, null, due, focus, null, null, doneScope, doneLimit, doneOffset);
    }

    public static BoardQuery from(String q, String owners, String pris, String cats, String reqs, String tags,
                                  String types, String versions, String due, Boolean focus, Boolean blocked, Boolean noDue,
                                  String doneScope, Integer doneLimit, Integer doneOffset) {
        BoardQuery query = new BoardQuery();
        query.q = trimToNull(q);
        query.owners = splitCsv(owners);
        query.pris = splitCsv(pris);
        query.cats = splitCsv(cats);
        query.reqs = splitCsv(reqs);
        query.tags = splitCsv(tags);
        query.types = splitCsv(types);
        query.versions = splitCsv(versions);
        query.due = trimToNull(due);
        query.focus = Boolean.TRUE.equals(focus);
        query.blocked = Boolean.TRUE.equals(blocked);
        query.noDue = Boolean.TRUE.equals(noDue);
        query.doneScope = "all".equals(doneScope) ? "all" : "week";
        if (doneLimit != null) {
            query.doneLimit = Math.max(1, Math.min(200, doneLimit));
        }
        if (doneOffset != null) {
            query.doneOffset = Math.max(0, doneOffset);
        }
        return query;
    }

    private static List<String> splitCsv(String value) {
        List<String> list = new ArrayList<String>();
        if (value == null || value.trim().isEmpty()) {
            return list;
        }
        for (String part : value.split(",")) {
            String item = part.trim();
            if (!item.isEmpty()) {
                list.add(item);
            }
        }
        return list;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
