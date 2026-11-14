package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.GitLabClient;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.BranchOutcomeBatchRequest;
import com.hourglass.dto.BranchOutcomeRequest;
import com.hourglass.dto.BranchOutcomeResult;
import com.hourglass.dto.BranchPendingGroup;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.DevBranch;
import com.hourglass.entity.DevBranchAlias;
import com.hourglass.entity.DevBranchLog;
import com.hourglass.entity.ProjectRepo;
import com.hourglass.mapper.DevBranchAliasMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectRepoMapper;
import com.hourglass.mapper.UserMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Git 只读同步引擎 + 分支生命周期。
 *
 * <p>单仓库失败只回写该仓库的 {@code last_sync_*} 与所属分支的 {@code sync_*}，
 * 不改远程状态与生命周期；绝不物理删除分支。人工判定优先级最高，同步只更新事实。
 */
@Service
public class GitSyncService {

    private static final Logger log = LoggerFactory.getLogger(GitSyncService.class);
    private static final int DECISION_REASON_MAX = 32;
    private static final Set<String> DECISIONS = new HashSet<String>(java.util.Arrays.asList(
            BranchLifecycleRules.OUTCOME_DONE, BranchLifecycleRules.OUTCOME_CANCELED,
            BranchLifecycleRules.OUTCOME_IGNORED));

    private final ProjectRepoMapper repoMapper;
    private final DevBranchMapper branchMapper;
    private final DevBranchAliasMapper aliasMapper;
    private final UserMapper userMapper;
    private final RepoService repoService;
    private final ProjectAccessService projectAccess;
    private final GitLabClient gitLab;

    public GitSyncService(ProjectRepoMapper repoMapper, DevBranchMapper branchMapper,
                          DevBranchAliasMapper aliasMapper, UserMapper userMapper,
                          RepoService repoService, ProjectAccessService projectAccess, GitLabClient gitLab) {
        this.repoMapper = repoMapper;
        this.branchMapper = branchMapper;
        this.aliasMapper = aliasMapper;
        this.userMapper = userMapper;
        this.repoService = repoService;
        this.projectAccess = projectAccess;
        this.gitLab = gitLab;
    }

    /** 同步结果摘要，手动同步接口回显用 */
    public static class SyncSummary {
        public int seen;
        public int created;
        public int adopted;
        public int renamed;
        public int disappeared;
        public int merged;
        public int pending;

        public String text() {
            return "分支 " + seen + "（新增 " + created + " / 收养 " + adopted
                    + " / 改名 " + renamed + " / 消失 " + disappeared + " / 合并 " + merged
                    + "），待确认 " + pending;
        }
    }

    /* ==================== 同步 ==================== */

    /**
     * 同步一个仓库。失败时只写同步状态并抛出，不改远程事实/生命周期。
     */
    public SyncSummary syncRepo(ProjectRepo repo) {
        LocalDateTime now = LocalDateTime.now();
        try {
            SyncSummary summary = doSync(repo, now);
            repoMapper.updateSyncResult(repo.getWorkspaceId(), repo.getId(), "ok", null,
                    Texts.cut(summary.text(), 500), now);
            return summary;
        } catch (Exception ex) {
            String msg = errorMessage(ex);
            log.warn("仓库同步失败 repo={}：{}", repo.getId(), msg);
            repoMapper.updateSyncResult(repo.getWorkspaceId(), repo.getId(), "error",
                    Texts.cut(msg, 500), null, now);
            try {
                branchMapper.updateSyncState(repo.getWorkspaceId(), repo.getId(), "error", Texts.cut(msg, 300));
            } catch (Exception ignored) {
                /* 连分支状态都写不进去时保留仓库级错误即可 */
            }
            if (ex instanceof AppException) {
                throw (AppException) ex;
            }
            throw new AppException(502, msg);
        }
    }

    private SyncSummary doSync(ProjectRepo repo, LocalDateTime now) {
        String ws = repo.getWorkspaceId();
        String repoId = repo.getId();
        String token = repoService.tokenOf(repo);

        List<GitLabClient.RemoteBranch> remote =
                gitLab.listBranches(repo.getRepoUrl(), repo.getProjectRef(), token);
        List<GitLabClient.MergedMr> mrs =
                gitLab.listMergedMrs(repo.getRepoUrl(), repo.getProjectRef(), token);

        Map<String, GitLabClient.RemoteBranch> remoteByName =
                new LinkedHashMap<String, GitLabClient.RemoteBranch>();
        for (GitLabClient.RemoteBranch rb : remote) {
            remoteByName.put(rb.name, rb);
        }
        Map<String, GitLabClient.MergedMr> mergedBySource = latestMerges(mrs);

        SyncSummary summary = new SyncSummary();
        List<DevBranch> tracked = branchMapper.selectByRepo(ws, repoId);
        Map<String, DevBranch> trackedByName = new HashMap<String, DevBranch>();
        for (DevBranch b : tracked) {
            trackedByName.put(b.getName(), b);
        }

        /* 1. 已跟踪分支：更新远程事实，或标记消失 */
        List<DevBranch> disappeared = new ArrayList<DevBranch>();
        for (DevBranch b : tracked) {
            GitLabClient.RemoteBranch rb = remoteByName.get(b.getName());
            if (rb == null) {
                branchMapper.markRemoteDeleted(ws, b.getId());
                disappeared.add(b);
                summary.disappeared++;
                continue;
            }
            branchMapper.updateRemoteFacts(ws, b.getId(), BranchLifecycleRules.REMOTE_ACTIVE,
                    rb.sha, rb.committedAt, rb.author, now, rb.sha);
            summary.seen++;
        }

        /* 2. 改名识别：旧名刚消失 + 新名未跟踪 + 同一 HEAD SHA + 30 分钟内 */
        Set<String> reservedNames = new HashSet<String>(trackedByName.keySet());
        for (DevBranch old : disappeared) {
            if (old.getLastSeenHeadSha() == null || old.getLastSeenAt() == null) {
                continue;
            }
            GitLabClient.RemoteBranch renamedTo = null;
            for (GitLabClient.RemoteBranch rb : remote) {
                if (reservedNames.contains(rb.name)) {
                    continue;
                }
                if (BranchLifecycleRules.isRename(old.getLastSeenHeadSha(), old.getLastSeenAt(),
                        rb.sha, now)) {
                    renamedTo = rb;
                    break;
                }
            }
            if (renamedTo == null) {
                continue;
            }
            branchMapper.renameById(ws, old.getId(), renamedTo.name);
            branchMapper.updateRemoteFacts(ws, old.getId(), BranchLifecycleRules.REMOTE_ACTIVE,
                    renamedTo.sha, renamedTo.committedAt, renamedTo.author, now, renamedTo.sha);
            writeAlias(ws, repoId, old.getId(), old.getName(), renamedTo.name, now);
            systemLog(old, "rename", null, null,
                    "远程分支改名：" + old.getName() + " → " + renamedTo.name + "（HEAD " + shortSha(renamedTo.sha) + "）");
            reservedNames.remove(old.getName());
            reservedNames.add(renamedTo.name);
            trackedByName.remove(old.getName());
            trackedByName.put(renamedTo.name, old);
            summary.renamed++;
            summary.seen++;
        }

        /* 3. 导入 / 收养：默认目标分支永不导入；手工分支优先被收养而不是新建一行 */
        Set<String> conflictIds = new HashSet<String>();
        for (GitLabClient.RemoteBranch rb : remote) {
            if (trackedByName.containsKey(rb.name)) {
                continue;
            }
            DevBranch manual = branchMapper.selectManualByName(ws, repo.getReqId(), rb.name);
            if (manual != null && manual.getRepoId() == null && !conflictIds.contains(manual.getId())) {
                branchMapper.adoptToRepo(ws, manual.getId(), repoId, rb.sha, rb.committedAt, rb.author,
                        now, rb.sha);
                systemLog(manual, "adopt", null, null,
                        "同步识别到同名远程分支，接管为跟踪分支（HEAD " + shortSha(rb.sha) + "）");
                trackedByName.put(rb.name, manual);
                summary.adopted++;
                summary.seen++;
                continue;
            }
            if (!BranchLifecycleRules.shouldImport(repo.getImportPolicy(), repo.getDefaultTarget(),
                    rb.name, rb.committedAt, now)) {
                continue;
            }
            DevBranch created = new DevBranch();
            created.setId(Ids.gen("B"));
            created.setWorkspaceId(ws);
            created.setReqId(repo.getReqId());
            created.setRepoId(repoId);
            created.setSource("git");
            created.setName(rb.name);
            created.setStatus(BranchService.ST_DEV);
            created.setRemoteState(BranchLifecycleRules.REMOTE_ACTIVE);
            created.setRemoteHeadSha(rb.sha);
            created.setRemoteHeadAt(rb.committedAt);
            created.setRemoteHeadAuthor(rb.author);
            created.setLastSeenAt(now);
            created.setLastSeenHeadSha(rb.sha);
            created.setMerged(Boolean.FALSE);
            created.setOutcome(BranchLifecycleRules.OUTCOME_OPEN);
            created.setSyncStatus("ok");
            created.setDevAt(now);
            try {
                branchMapper.insertGitBranch(created);
                summary.created++;
                summary.seen++;
                trackedByName.put(rb.name, created);
            } catch (org.springframework.dao.DuplicateKeyException e) {
                DevBranch existing = branchMapper.selectByRepoAndName(ws, repoId, rb.name);
                if (existing == null) {
                    throw e;
                }
                /* 命名空间被占用（多为并发同步）：保留现场，转人工确认，不覆盖任何一方 */
                branchMapper.updateOutcome(ws, existing.getId(),
                        BranchLifecycleRules.OUTCOME_PENDING, BranchLifecycleRules.PENDING_NAME_CONFLICT);
                conflictIds.add(existing.getId());
                trackedByName.put(rb.name, existing);
            }
        }

        /* 4. 合并证据：已合并 MR 是 done 的硬证据；只增不减 */
        for (Map.Entry<String, DevBranch> entry : trackedByName.entrySet()) {
            GitLabClient.MergedMr mr = mergedBySource.get(entry.getKey());
            if (mr == null) {
                continue;
            }
            DevBranch b = entry.getValue();
            if (Boolean.TRUE.equals(b.getMerged())) {
                continue;
            }
            branchMapper.updateMerge(ws, b.getId(), mr.targetBranch, mr.mergedAt,
                    mergeEvidence(mr));
            summary.merged++;
        }

        /* 5. 重算生命周期：人工判定优先，其次合并证据，再其次远程状态 */
        for (DevBranch b : branchMapper.selectByRepo(ws, repoId)) {
            if (conflictIds.contains(b.getId())) {
                continue;
            }
            BranchLifecycleRules.Result r = BranchLifecycleRules.evaluate(
                    b.getRemoteState(), Boolean.TRUE.equals(b.getMerged()), b.getRemoteHeadAt(),
                    b.getDecision(), b.getDecidedAt(), b.getOutcome());
            if (r.outcome.equals(b.getOutcome()) && eq(r.pendingReason, b.getPendingReason())) {
                if (BranchLifecycleRules.OUTCOME_PENDING.equals(r.outcome)) {
                    summary.pending++;
                }
                continue;
            }
            branchMapper.updateOutcome(ws, b.getId(), r.outcome, r.pendingReason);
            if (BranchLifecycleRules.OUTCOME_PENDING.equals(r.outcome)) {
                summary.pending++;
                systemLog(b, "outcome", b.getOutcome(), r.outcome,
                        "转待确认：" + pendingLabel(r.pendingReason));
            } else {
                systemLog(b, "outcome", b.getOutcome(), r.outcome,
                        "同步重算生命周期：" + outcomeLabel(r.outcome));
            }
        }
        for (String id : conflictIds) {
            summary.pending++;
        }
        return summary;
    }

    private Map<String, GitLabClient.MergedMr> latestMerges(List<GitLabClient.MergedMr> mrs) {
        Map<String, GitLabClient.MergedMr> out = new LinkedHashMap<String, GitLabClient.MergedMr>();
        for (GitLabClient.MergedMr mr : mrs) {
            GitLabClient.MergedMr old = out.get(mr.sourceBranch);
            if (old == null || (mr.mergedAt != null
                    && (old.mergedAt == null || mr.mergedAt.isAfter(old.mergedAt)))) {
                out.put(mr.sourceBranch, mr);
            }
        }
        return out;
    }

    private static String mergeEvidence(GitLabClient.MergedMr mr) {
        StringBuilder sb = new StringBuilder();
        if (mr.iid != null) {
            sb.append("MR !").append(mr.iid);
        }
        if (mr.targetBranch != null) {
            if (sb.length() > 0) {
                sb.append(" → ");
            }
            sb.append(mr.targetBranch);
        }
        if (mr.webUrl != null) {
            if (sb.length() > 0) {
                sb.append(" · ");
            }
            sb.append(mr.webUrl);
        }
        return Texts.cut(sb.length() == 0 ? "已合并 MR" : sb.toString(), 300);
    }

    private void writeAlias(String ws, String repoId, String branchId, String oldName,
                            String newName, LocalDateTime at) {
        DevBranchAlias alias = new DevBranchAlias();
        alias.setId(Ids.gen("BA"));
        alias.setWorkspaceId(ws);
        alias.setRepoId(repoId);
        alias.setBranchId(branchId);
        alias.setOldName(oldName);
        alias.setNewName(newName);
        alias.setDetectedAt(at);
        try {
            aliasMapper.insert(alias);
        } catch (org.springframework.dao.DuplicateKeyException ignored) {
            /* 同一旧名多次消失只保留第一条改名记录；不影响分支本身 */
        }
    }

    /* ==================== 定时同步 ==================== */

    /**
     * 每 10 分钟扫描启用且超过 10 分钟没同步的仓库，串行执行；单仓库异常只记日志。
     */
    @Scheduled(fixedDelayString = "${app.git.sync-ms:600000}",
            initialDelayString = "${app.git.initial-delay-ms:60000}")
    public void scheduledSync() {
        LocalDateTime before = LocalDateTime.now().minusMinutes(10);
        List<ProjectRepo> due = repoMapper.selectDue(before, 20);
        for (ProjectRepo repo : due) {
            try {
                syncRepo(repo);
            } catch (Exception ex) {
                log.warn("定时同步仓库失败 repo={}：{}", repo.getId(), errorMessage(ex));
            }
        }
    }

    /* ==================== 待确认 ==================== */

    public List<BranchPendingGroup> pendingGroups(String workspaceId, String userId) {
        return pendingGroups(workspaceId, userId, null);
    }

    /**
     * 待确认分组。项目/仓库/负责人/版本/关键词与看板同口径；状态与 outcome 不参与，
     * 否则「待确认」在不同筛选下会互相矛盾。
     */
    public List<BranchPendingGroup> pendingGroups(String workspaceId, String userId,
                                                  com.hourglass.dto.BranchQuery query) {
        com.hourglass.dto.BranchQuery q = query == null ? new com.hourglass.dto.BranchQuery() : query;
        q.setWorkspaceId(workspaceId);
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        q.setViewerId(viewerId);
        q.setStatus(null);
        q.setOutcome(null);
        q.setProjectId(Texts.trimToNull(q.getProjectId()));
        q.setOwnerUserId(Texts.trimToNull(q.getOwnerUserId()));
        q.setVersionId(Texts.trimToNull(q.getVersionId()));
        q.setRepoId(Texts.trimToNull(q.getRepoId()));
        q.setQ(Texts.trimToNull(q.getQ()));
        List<DevBranch> pending = branchMapper.selectPending(q);
        Map<String, ProjectRepo> repos = new HashMap<String, ProjectRepo>();
        for (ProjectRepo repo : repoMapper.selectVisible(workspaceId, viewerId)) {
            repos.put(repo.getId(), repo);
        }
        Map<String, BranchPendingGroup> groups = new LinkedHashMap<String, BranchPendingGroup>();
        for (DevBranch b : pending) {
            String key = b.getRepoId() == null ? "__unbound__" : b.getRepoId();
            BranchPendingGroup g = groups.get(key);
            if (g == null) {
                g = new BranchPendingGroup();
                ProjectRepo repo = b.getRepoId() == null ? null : repos.get(b.getRepoId());
                g.setRepoId(b.getRepoId());
                if (repo != null) {
                    g.setRepoName(repo.getName());
                    g.setRepoUrl(repo.getRepoUrl());
                    g.setReqId(repo.getReqId());
                    g.setReqName(repo.getReqName());
                } else {
                    g.setRepoName(b.getRepoName() == null ? "已解绑仓库" : b.getRepoName());
                    g.setRepoUrl(b.getRepoUrl());
                    g.setReqId(b.getReqId());
                }
                groups.put(key, g);
            }
            g.add(b);
        }
        return new ArrayList<BranchPendingGroup>(groups.values());
    }

    /* ==================== 人工判定 ==================== */

    /**
     * 单条人工判定。decision 为空 = 撤销判定，立即按远程事实重算。
     *
     * <p>batch 不走同一个事务：批量里每条独立提交，单条失败不回滚已成功的条目
     * （需求明确要求「单条失败不中断整批」）；代价是极端崩溃下可能留下
     * 「判定已写、生命周期未重算」的中间态，下一次同步会自动纠正。
     */
    @Transactional
    public DevBranch decide(String userId, String workspaceId, String branchId, BranchOutcomeRequest req) {
        return decideInternal(userId, workspaceId, branchId, req);
    }

    public List<BranchOutcomeResult> decideBatch(String userId, String workspaceId,
                                                 BranchOutcomeBatchRequest req) {
        String decision = normalizeDecision(req.getDecision());
        String reason = Texts.cut(Texts.trimToNull(req.getReason()), DECISION_REASON_MAX);
        validateReason(decision, Texts.trimToNull(req.getReason()));
        String note = Texts.cut(Texts.trimToNull(req.getNote()), 200);
        List<BranchOutcomeResult> results = new ArrayList<BranchOutcomeResult>();
        for (String id : req.getIds()) {
            DevBranch b = null;
            try {
                BranchOutcomeRequest one = new BranchOutcomeRequest();
                one.setDecision(decision);
                one.setReason(reason);
                one.setNote(note);
                b = decideInternal(userId, workspaceId, id, one);
                results.add(BranchOutcomeResult.ok(id, b.getName(), b.getOutcome()));
            } catch (Exception ex) {
                String name = b == null ? null : b.getName();
                results.add(BranchOutcomeResult.fail(id, name, errorMessage(ex)));
            }
        }
        return results;
    }

    private DevBranch decideInternal(String userId, String workspaceId, String branchId,
                                     BranchOutcomeRequest req) {
        DevBranch b = branchMapper.selectById(branchId);
        if (b == null || !workspaceId.equals(b.getWorkspaceId())) {
            throw AppException.notFound("分支不存在：" + branchId);
        }
        projectAccess.assertView(workspaceId, userId, b.getReqId());
        projectAccess.assertWrite(workspaceId, userId, b.getReqId());

        String decision = normalizeDecision(req.getDecision());
        String rawReason = Texts.trimToNull(req.getReason());
        validateReason(decision, rawReason);
        String reason = Texts.cut(rawReason, DECISION_REASON_MAX);
        String note = Texts.cut(Texts.trimToNull(req.getNote()), 200);
        String before = b.getOutcome();

        if (decision == null) {
            branchMapper.clearDecision(workspaceId, branchId);
            DevBranch refreshed = branchMapper.selectById(branchId);
            BranchLifecycleRules.Result r = BranchLifecycleRules.evaluate(
                    refreshed.getRemoteState(), Boolean.TRUE.equals(refreshed.getMerged()),
                    refreshed.getRemoteHeadAt(), null, null, refreshed.getOutcome());
            if (!r.outcome.equals(refreshed.getOutcome()) || !eq(r.pendingReason, refreshed.getPendingReason())) {
                branchMapper.updateOutcome(workspaceId, branchId, r.outcome, r.pendingReason);
            }
            userLog(userId, workspaceId, branchId, "decision", before, r.outcome,
                    "撤销人工判定，按远程事实重算为「" + outcomeLabel(r.outcome) + "」");
            return branchMapper.selectById(branchId);
        }

        LocalDateTime now = LocalDateTime.now();
        branchMapper.applyDecision(workspaceId, branchId, decision, reason, note, userId, now);
        DevBranch after = branchMapper.selectById(branchId);
        BranchLifecycleRules.Result r = BranchLifecycleRules.evaluate(
                after.getRemoteState(), Boolean.TRUE.equals(after.getMerged()), after.getRemoteHeadAt(),
                decision, after.getDecidedAt(), decision);
        if (!r.outcome.equals(after.getOutcome()) || !eq(r.pendingReason, after.getPendingReason())) {
            branchMapper.updateOutcome(workspaceId, branchId, r.outcome, r.pendingReason);
        }
        String detail = "人工判定：「" + outcomeLabel(decision) + "」"
                + (reason == null ? "" : "（理由：" + reason + "）")
                + (note == null ? "" : "（备注：" + note + "）");
        if (BranchLifecycleRules.OUTCOME_PENDING.equals(r.outcome)) {
            detail += "；判定后远程出现新提交，转待确认";
        }
        userLog(userId, workspaceId, branchId, "decision", before, r.outcome, detail);
        return branchMapper.selectById(branchId);
    }

    private static String normalizeDecision(String raw) {
        String decision = Texts.trimToNull(raw);
        if (decision == null) {
            return null;
        }
        if (!DECISIONS.contains(decision)) {
            throw AppException.badRequest("人工判定只能是 done / canceled / ignored");
        }
        return decision;
    }

    private static void validateReason(String decision, String reason) {
        if (BranchLifecycleRules.OUTCOME_CANCELED.equals(decision)
                || BranchLifecycleRules.OUTCOME_IGNORED.equals(decision)) {
            if (reason == null) {
                throw AppException.badRequest("取消或忽略必须填写理由");
            }
            if (reason.codePointCount(0, reason.length()) > DECISION_REASON_MAX) {
                throw AppException.badRequest("理由不能超过 " + DECISION_REASON_MAX + " 字");
            }
        }
    }

    /* ==================== 日志 ==================== */

    private void systemLog(DevBranch b, String action, String from, String to, String detail) {
        DevBranchLog l = new DevBranchLog();
        l.setId(Ids.gen("BL"));
        l.setWorkspaceId(b.getWorkspaceId());
        l.setBranchId(b.getId());
        l.setAction(action);
        l.setFromStatus(from);
        l.setToStatus(to);
        l.setDetail(Texts.cut(detail, 200));
        l.setActorName("系统同步");
        l.setActorType("system");
        branchMapper.insertLog(l);
    }

    private void userLog(String userId, String workspaceId, String branchId, String action,
                         String from, String to, String detail) {
        DevBranchLog l = new DevBranchLog();
        l.setId(Ids.gen("BL"));
        l.setWorkspaceId(workspaceId);
        l.setBranchId(branchId);
        l.setAction(action);
        l.setFromStatus(from);
        l.setToStatus(to);
        l.setDetail(Texts.cut(detail, 200));
        AppUser u = userMapper.selectById(userId);
        l.setActorName(u == null ? null : Texts.cut(u.getDisplayName(), 32));
        l.setActorUserId(userId);
        l.setActorType("user");
        branchMapper.insertLog(l);
    }

    /* ==================== 工具 ==================== */

    private static String outcomeLabel(String outcome) {
        if (BranchLifecycleRules.OUTCOME_OPEN.equals(outcome)) {
            return "进行中";
        }
        if (BranchLifecycleRules.OUTCOME_DONE.equals(outcome)) {
            return "已完成";
        }
        if (BranchLifecycleRules.OUTCOME_CANCELED.equals(outcome)) {
            return "已取消";
        }
        if (BranchLifecycleRules.OUTCOME_IGNORED.equals(outcome)) {
            return "已忽略";
        }
        if (BranchLifecycleRules.OUTCOME_PENDING.equals(outcome)) {
            return "待确认";
        }
        return outcome == null ? "未判定" : outcome;
    }

    private static String pendingLabel(String reason) {
        if (BranchLifecycleRules.PENDING_DISAPPEARED.equals(reason)) {
            return "远程分支已消失，需确认是合并还是放弃";
        }
        if (BranchLifecycleRules.PENDING_CLOSED_NEW_COMMIT.equals(reason)) {
            return "已人工关闭后远程又出现新提交";
        }
        if (BranchLifecycleRules.PENDING_NAME_CONFLICT.equals(reason)) {
            return "分支名与已有分支冲突";
        }
        return reason == null ? "需要人工确认" : reason;
    }

    private static String shortSha(String sha) {
        return sha == null || sha.length() <= 8 ? sha : sha.substring(0, 8);
    }

    private static String errorMessage(Exception ex) {
        String msg = ex instanceof AppException ? ex.getMessage() : ex.getMessage();
        if (msg == null || msg.isEmpty()) {
            msg = ex.getClass().getSimpleName();
        }
        return Texts.cut(msg, 300);
    }

    private static boolean eq(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }
}
