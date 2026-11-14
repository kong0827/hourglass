package com.hourglass.dto;

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
    /** 测试负责人显示名，__none 表示待领取 */
    private List<String> testOwners = Collections.emptyList();
    private List<String> pris = Collections.emptyList();
    private List<String> cats = Collections.emptyList();
    private List<String> reqs = Collections.emptyList();
    private List<String> tags = Collections.emptyList();
    private List<String> types = Collections.emptyList();
    /** 影响版本ID列表，__none 表示待规划 */
    private List<String> versions = Collections.emptyList();
    /** 看板列（状态）ID 列表 */
    private List<String> columns = Collections.emptyList();
    /** 完成情况：null=全部，open=未完成，done=已完成 */
    private String completion;
    private boolean blocked;
    private String due;
    private boolean focus;
    private boolean noDue;
    private LocalDate dueFrom;
    private LocalDate dueTo;
    private LocalDate startFrom;
    private LocalDate startTo;
    private LocalDate today = LocalDate.now();
    private boolean nameOnly;
    /** true=「待我测试」口径（我负责测试 + 我能写项目里无人认领的待测试） */
    private boolean testScope;
    private int offset;
    private int limit = 100;

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

    public List<String> getTestOwners() {
        return testOwners;
    }

    public void setTestOwners(List<String> testOwners) {
        this.testOwners = testOwners == null ? Collections.<String>emptyList() : testOwners;
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

    public List<String> getVersions() {
        return versions;
    }

    public void setVersions(List<String> versions) {
        this.versions = versions == null ? Collections.<String>emptyList() : versions;
    }

    public List<String> getColumns() {
        return columns;
    }

    public void setColumns(List<String> columns) {
        this.columns = columns == null ? Collections.<String>emptyList() : columns;
    }

    public String getCompletion() {
        return completion;
    }

    public void setCompletion(String completion) {
        this.completion = completion;
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

    public boolean isNoDue() {
        return noDue;
    }

    public void setNoDue(boolean noDue) {
        this.noDue = noDue;
    }

    public LocalDate getDueFrom() {
        return dueFrom;
    }

    public void setDueFrom(LocalDate dueFrom) {
        this.dueFrom = dueFrom;
    }

    public LocalDate getDueTo() {
        return dueTo;
    }

    public void setDueTo(LocalDate dueTo) {
        this.dueTo = dueTo;
    }

    public LocalDate getStartFrom() {
        return startFrom;
    }

    public void setStartFrom(LocalDate startFrom) {
        this.startFrom = startFrom;
    }

    public LocalDate getStartTo() {
        return startTo;
    }

    public void setStartTo(LocalDate startTo) {
        this.startTo = startTo;
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

    public boolean isTestScope() {
        return testScope;
    }

    public void setTestScope(boolean testScope) {
        this.testScope = testScope;
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
