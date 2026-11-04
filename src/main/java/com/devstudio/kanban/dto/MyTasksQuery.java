package com.devstudio.kanban.dto;

import java.time.LocalDate;
import java.util.Collections;
import java.util.List;

/**
 * 跨空间「我的任务」查询参数。
 * 三条 SQL（列表 / 计数 / 覆盖空间）共用同一个参数对象，保证 WHERE 口径完全一致。
 */
public class MyTasksQuery {

    private String userId;
    private String displayName;
    private boolean openOnly;
    private String q;
    private List<String> pris = Collections.emptyList();
    private List<String> cats = Collections.emptyList();
    private List<String> reqs = Collections.emptyList();
    private List<String> tags = Collections.emptyList();
    private List<String> types = Collections.emptyList();
    private boolean blocked;
    private String due;
    private boolean focus;
    private LocalDate today = LocalDate.now();
    private boolean nameOnly;
    private int offset;
    private int limit = 200;

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public boolean isOpenOnly() {
        return openOnly;
    }

    public void setOpenOnly(boolean openOnly) {
        this.openOnly = openOnly;
    }

    public String getQ() {
        return q;
    }

    public void setQ(String q) {
        this.q = q;
    }

    public List<String> getPris() {
        return pris;
    }

    public void setPris(List<String> pris) {
        this.pris = pris == null ? Collections.<String>emptyList() : pris;
    }

    public List<String> getCats() {
        return cats;
    }

    public void setCats(List<String> cats) {
        this.cats = cats == null ? Collections.<String>emptyList() : cats;
    }

    public List<String> getReqs() {
        return reqs;
    }

    public void setReqs(List<String> reqs) {
        this.reqs = reqs == null ? Collections.<String>emptyList() : reqs;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags == null ? Collections.<String>emptyList() : tags;
    }

    public List<String> getTypes() {
        return types;
    }

    public void setTypes(List<String> types) {
        this.types = types == null ? Collections.<String>emptyList() : types;
    }

    public boolean isBlocked() {
        return blocked;
    }

    public void setBlocked(boolean blocked) {
        this.blocked = blocked;
    }

    public String getDue() {
        return due;
    }

    public void setDue(String due) {
        this.due = due;
    }

    public boolean isFocus() {
        return focus;
    }

    public void setFocus(boolean focus) {
        this.focus = focus;
    }

    public LocalDate getToday() {
        return today;
    }

    public void setToday(LocalDate today) {
        this.today = today;
    }

    public boolean isNameOnly() {
        return nameOnly;
    }

    public void setNameOnly(boolean nameOnly) {
        this.nameOnly = nameOnly;
    }

    public int getOffset() {
        return offset;
    }

    public void setOffset(int offset) {
        this.offset = offset;
    }

    public int getLimit() {
        return limit;
    }

    public void setLimit(int limit) {
        this.limit = limit;
    }
}
