package com.hourglass.service;

import java.time.Duration;
import java.time.LocalDateTime;

/**
 * 分支生命周期纯规则：不碰数据库、不依赖 Spring，方便单测覆盖。
 *
 * <p>优先级：人工判定 &gt; 合并证据 &gt; 远程消失 &gt; 远程存在。
 * 人工判定的「关闭」不是永久终态：关闭后远程又出现新提交时只转为「待确认」，
 * 保留原判定，由人再次确认，避免系统擅自把已取消的分支重新打开。
 */
public final class BranchLifecycleRules {

    public static final String OUTCOME_OPEN = "open";
    public static final String OUTCOME_DONE = "done";
    public static final String OUTCOME_CANCELED = "canceled";
    public static final String OUTCOME_IGNORED = "ignored";
    public static final String OUTCOME_PENDING = "pending";

    public static final String PENDING_DISAPPEARED = "disappeared";
    public static final String PENDING_CLOSED_NEW_COMMIT = "closed_new_commit";
    public static final String PENDING_NAME_CONFLICT = "name_conflict";

    public static final String REMOTE_ACTIVE = "active";
    public static final String REMOTE_DELETED = "deleted";

    /** 改名识别窗口：旧分支最后一次出现到本次同步之间不超过 30 分钟 */
    public static final Duration RENAME_WINDOW = Duration.ofMinutes(30);

    private BranchLifecycleRules() {
    }

    public static final class Result {
        public final String outcome;
        public final String pendingReason;

        Result(String outcome, String pendingReason) {
            this.outcome = outcome;
            this.pendingReason = pendingReason;
        }

        public static Result of(String outcome, String pendingReason) {
            return new Result(outcome, pendingReason);
        }
    }

    /**
     * 同步完成后计算生命周期。
     *
     * @param remoteState   active / deleted / null（手工分支）
     * @param merged        是否存在已合并 MR 证据
     * @param remoteHeadAt  远程 HEAD 提交时间
     * @param decision      人工判定 done/canceled/ignored；null 表示未判定
     * @param decidedAt     判定时间
     * @param current       当前 outcome；远程事实缺失时保持不变
     */
    public static Result evaluate(String remoteState, boolean merged, LocalDateTime remoteHeadAt,
                                  String decision, LocalDateTime decidedAt, String current) {
        if (decision != null && !decision.isEmpty()) {
            /* 只有「关闭」类判定会因远程新提交转待确认；人工完成是终态 */
            boolean closed = OUTCOME_CANCELED.equals(decision) || OUTCOME_IGNORED.equals(decision);
            if (closed && hasNewCommitAfterDecision(remoteState, remoteHeadAt, decidedAt)) {
                return Result.of(OUTCOME_PENDING, PENDING_CLOSED_NEW_COMMIT);
            }
            return Result.of(decision, null);
        }
        if (merged) {
            return Result.of(OUTCOME_DONE, null);
        }
        if (REMOTE_DELETED.equals(remoteState)) {
            return Result.of(OUTCOME_PENDING, PENDING_DISAPPEARED);
        }
        if (REMOTE_ACTIVE.equals(remoteState)) {
            return Result.of(OUTCOME_OPEN, null);
        }
        return Result.of(current == null || current.isEmpty() ? OUTCOME_OPEN : current, null);
    }

    /** 人工关闭后，远程分支仍在且有晚于判定时间的新提交 */
    public static boolean hasNewCommitAfterDecision(String remoteState, LocalDateTime remoteHeadAt,
                                                    LocalDateTime decidedAt) {
        return REMOTE_ACTIVE.equals(remoteState) && remoteHeadAt != null && decidedAt != null
                && remoteHeadAt.isAfter(decidedAt);
    }

    /**
     * 改名识别：旧分支刚消失、新分支刚出现、HEAD SHA 相同，且旧分支最后一次出现距本次同步不超过 30 分钟。
     * 三个条件同时满足才认，避免把「删旧建新但碰巧同一提交」误判为改名。
     */
    public static boolean isRename(String lastSeenHeadSha, LocalDateTime lastSeenAt,
                                   String newHeadSha, LocalDateTime now) {
        if (lastSeenHeadSha == null || lastSeenAt == null || newHeadSha == null) {
            return false;
        }
        if (!lastSeenHeadSha.equals(newHeadSha)) {
            return false;
        }
        return !lastSeenAt.isBefore(now.minus(RENAME_WINDOW));
    }

    /**
     * 首次导入策略：manual 不自动导入；all 全导；recent90 只导 90 天内有提交的。
     * 默认目标分支永远不导入（它是主干，不是一次开发）。
     */
    public static boolean shouldImport(String policy, String defaultTarget, String branchName,
                                       LocalDateTime committedAt, LocalDateTime now) {
        if (branchName == null) {
            return false;
        }
        if (defaultTarget != null && defaultTarget.equals(branchName)) {
            return false;
        }
        if ("manual".equals(policy)) {
            return false;
        }
        if ("all".equals(policy)) {
            return true;
        }
        /* recent90 是默认策略：没有提交时间的无法证明「近期」，不导入 */
        return committedAt != null && !committedAt.isBefore(now.minusDays(90));
    }
}
