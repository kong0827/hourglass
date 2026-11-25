package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 团队周回顾：一周的事件汇总 + 当前快照。
 *
 * <p>行与行是不同对象（需求 / 工作项 / 测试 / 文档），数量不可相加；
 * 事件数按周切换，在手、待回归、草稿积压等快照不随周变化。</p>
 */
@Data
public class ReviewTeamResponse {

    private int weekOffset;
    /** team / mine：团队口径或个人口径 */
    private String scope;
    /** 成员职能过滤：all/dev/test/pm/design/lead */
    private String role;
    /** yyyy-MM-dd */
    private String weekStart;
    private String weekEnd;
    /** 本周 / 上周 / 该周期 */
    private String label;
    private String reqId;
    private String reqName;
    /** 快照口径时间点，如 2026-11-20T09:20:00+08:00 */
    private String asOf;

    private Stats stats = new Stats();
    private Pace pace = new Pace();
    private Trend trend = new Trend();
    private Pool pool = new Pool();
    private Releases releases = new Releases();
    private Completions completions = new Completions();
    private Quality quality = new Quality();
    private Docs docs = new Docs();
    private List<MemberRow> members = new ArrayList<MemberRow>();
    private List<ProjectRow> projects = new ArrayList<ProjectRow>();
    private Risks risks = new Risks();

    @Data
    public static class Stats {
        private Demands demands = new Demands();
        private Work workItems = new Work();
        private Tests tests = new Tests();
        private DocSummary docs = new DocSummary();
    }

    @Data
    public static class Demands {
        private int created;
        private int createdDelta;
        private int passed;
        private int planned;
        private int completed;
        private int completedDelta;
        /** 本周成功生产发布覆盖的需求数（去重） */
        private int released;
        /** 本周发布记录数（成功 + 生产 + 非回滚 + 全量） */
        private int releaseCount;
        /** 评审不通过 + 以重复关闭 */
        private int closed;
        /** 中途取消 */
        private int cancelled;
    }

    @Data
    public static class Work {
        private int created;
        private int createdDelta;
        private int story;
        private int task;
        private int bug;
        private int epic;
        /** 流转次数 = 进入处理中 + 提测 + 进入测试中（同一项可连续流转） */
        private int transitionEvents;
        /** 流转涉及的工作项数（按项去重） */
        private int transitionItems;
        private int enteredDoing;
        private int testRequested;
        private int enteredTesting;
        private int completed;
        private int completedDelta;
        private int doneStory;
        private int doneTask;
        private int doneBug;
        private int cancelled;
    }

    @Data
    public static class Tests {
        private int newCases;
        private int newDefects;
        private int runs;
        private int passed;
        private int failed;
        private int blocked;
        private int skipped;
        private int passRate;
        /** 本周完成的缺陷工作项 */
        private int fixed;
        /** 当前快照：最近一次执行仍失败 */
        private int pendingRetest;
    }

    @Data
    public static class DocSummary {
        private int created;
        private int updated;
        private int published;
        private int draftBacklog;
    }

    @Data
    public static class Pace {
        /** 周一至周日每天完成的工作项数 */
        private List<Integer> daily = new ArrayList<Integer>();
        private int started;
        private int minutes;
        private int capacityMinutes;
        private int utilization;
        private int onTimeRate;
        private int onTime;
        private int withDue;
        private int testPlanDone;
        private int testPlanTotal;
        /** 截止日落在本周期的工作项总数（不含取消 / 删除） */
        private int dueTotal;
        private int dueOnTime;
        private int dueLate;
        private int dueOpen;
        private int dueRate;
    }

    /** 近 4 个周期的同口径趋势，最后一位是当前查看的周期。 */
    @Data
    public static class Trend {
        private List<String> labels = new ArrayList<String>();
        private List<Integer> created = new ArrayList<Integer>();
        private List<Integer> completed = new ArrayList<Integer>();
        private List<Integer> transitions = new ArrayList<Integer>();
    }

    @Data
    public static class Pool {
        private int demandReview;
        private int demandPass;
        private int demandPlan;
        private int demandDone;
        private int taskOpen;
        private int taskDoing;
        private int taskTest;
        private int taskTesting;
        private int taskBacklog;
    }

    @Data
    public static class Releases {
        private int planTotal;
        private int planCompleted;
        private int planReadyOverdue;
        private int rolledBack;
        private int releaseCount;
        private int demandCount;
        private List<ReleaseItem> items = new ArrayList<ReleaseItem>();
    }

    @Data
    public static class ReleaseItem {
        private String id;
        private String projectName;
        private String versionName;
        private String at;
        private String executor;
        private int demands;
        private int tasks;
        private String note;
    }

    @Data
    public static class Completions {
        private int total;
        private int story;
        private int task;
        private int bug;
        private int released;
        private int moreStory;
        private int moreTask;
        private int moreBug;
        private List<CompletionItem> items = new ArrayList<CompletionItem>();
    }

    @Data
    public static class CompletionItem {
        private String taskId;
        private String title;
        private String type;
        private String typeLabel;
        private String projectName;
        private String demandTitle;
        private String at;
        private String dueDate;
        private int minutes;
        private int durationDays;
        private boolean onTime;
        private boolean released;
    }

    @Data
    public static class Quality {
        private int runs;
        private int passRate;
        private int newCases;
        private int defects;
        private int fixed;
        private int pendingRetest;
        /** 本周登记在测试中列 / 缺陷工作项上的工时 */
        private int minutes;
        private int participants;
        private Results results = new Results();
        private List<TestMember> members = new ArrayList<TestMember>();
        private List<TestPlanRow> plans = new ArrayList<TestPlanRow>();
        private DefectPriority defectsByPriority = new DefectPriority();
    }

    @Data
    public static class Results {
        private int passed;
        private int failed;
        private int blocked;
        private int skipped;
    }

    @Data
    public static class TestMember {
        private String userId;
        private String name;
        private String roleCode;
        private String roleTitle;
        private String projects;
        private int runs;
        private int passRate;
        private int newCases;
        private int defects;
    }

    @Data
    public static class TestPlanRow {
        private String id;
        private String name;
        private String status;
        private int progress;
        private String due;
        private int overdueDays;
        private int passed;
        private int total;
    }

    @Data
    public static class DefectPriority {
        private int closed;
        private int p0;
        private int p1;
        private int p2;
        private int p3;
    }

    @Data
    public static class Docs {
        private int created;
        private int updated;
        private int published;
        private int draftBacklog;
        private String oldestDraft;
        private int projectCount;
        private int demandCount;
        private List<CountRow> byType = new ArrayList<CountRow>();
        private List<DocMember> members = new ArrayList<DocMember>();
        /** 本周有完成 / 推进但没有文档动作的成员 */
        private List<String> silent = new ArrayList<String>();
    }

    @Data
    public static class CountRow {
        private String key;
        private String label;
        private int count;
    }

    @Data
    public static class DocMember {
        private String userId;
        private String name;
        private String roleCode;
        private String roleTitle;
        private String projects;
        private int total;
        private int created;
        private int updated;
    }

    @Data
    public static class MemberRow {
        private String userId;
        private String name;
        private String roleCode;
        private String roleTitle;
        private String projects;
        private int created;
        private int started;
        private int done;
        private int open;
        private int minutes;
        private int load;
        private int overdue;
        private int blocked;
        private int docs;
        /** 本周不参与测试时为 -1，前端显示「—」 */
        private int testRuns;
        private int testDefects;
        private int testPassRate;
        private boolean unlogged;
        /** 本周期没有新增 / 流转 / 完成 / 工时 / 文档 / 测试 / 评论 / 需求动作 / 发布记录 */
        private boolean idle;
    }

    @Data
    public static class ProjectRow {
        private String reqId;
        private String name;
        private String code;
        private int demandCreated;
        private int demandStarted;
        private int demandCompleted;
        private int demandReleased;
        private int taskCreated;
        private int taskDone;
        private int minutes;
        private String statusLabel;
        private String statusTone;
    }

    @Data
    public static class Risks {
        private int overdue;
        private int blocked;
        private int overloaded;
        private int unlogged;
        private int nextDue;
        private int p0;
        private int pendingRelease;
        private int releaseOverdue;
        private int testPlanOverdue;
        private int stale;
        /** 本周期没有任何活动记录的成员数（见 MemberRow.idle） */
        private int idle;
        private String idleSample;
        /** 视图周期的下一周到期工作项（最多 5 条） */
        private String nextLabel;
        /** 下一周的日期区间（MM-dd — MM-dd），避免相对周标签歧义 */
        private String nextRange;
        private int nextMilestones;
        private List<DetailItem> nextItems = new ArrayList<DetailItem>();
        private String overdueSample;
        private String blockedSample;
        private String overloadSample;
        private String unloggedSample;
    }

    /** 明细条目：kind=demand/task/case/doc；只有 demand / task 可点开详情 */
    @Data
    public static class DetailItem {
        private String kind;
        private String id;
        private String type;
        private String typeLabel;
        private String title;
        private String meta;
        private String at;
        private String tone;
    }
}
