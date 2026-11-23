package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.PlanVersionRow;
import com.hourglass.dto.ReleasePlanWatchRow;
import com.hourglass.dto.ReleasePrepCheckRequest;
import com.hourglass.dto.ReleasePrepNotifyRequest;
import com.hourglass.dto.ReleasePrepTaskRow;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.ReleasePlanPush;
import com.hourglass.entity.ReleasePlanTaskCheck;
import com.hourglass.entity.VersionReleasePlan;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.ReleasePrepMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 发布准备与发布计划关注。
 *
 * <p>发布准备是提醒而不是门禁：推送/回执/逐项确认都不改变工作项状态，也不参与发布检查。
 * 回执按推送批次记录；逐项确认按 (计划, 工作项, 人) 记录，计划保存删除重建计划任务时仍保留，
 * 汇总时只统计当前计划范围内、且仍是该工作项负责人的确认。</p>
 */
@Service
public class ReleasePrepService {

    private static final Logger log = LoggerFactory.getLogger(ReleasePrepService.class);
    private static final DateTimeFormatter MINUTE = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final List<String> CHANNELS = Arrays.asList("in_app", "email", "group");
    private static final List<String> DEFAULT_CHANNELS = Arrays.asList("in_app", "email");
    private static final long DUPLICATE_PUSH_WINDOW_SECONDS = 30L;
    private static final int MAX_NOTE = 200;
    private static final int MAX_PAGE_SIZE = 100;
    private static final int DEFAULT_PUSH_HISTORY = 20;
    private static final int MAX_PUSH_HISTORY = 50;

    @Value("${app.mail.base-url:}")
    private String mailBaseUrl;

    private final ReleasePrepMapper prepMapper;
    private final ReleaseMapper releaseMapper;
    private final ProjectAccessService access;
    private final ReleasePermissionService permissions;
    private final WorkspaceMemberMapper memberMapper;
    private final UserMapper userMapper;
    private final UserNotificationPreferenceService preferences;
    private final AppNotificationService inApp;
    private final MailDeliveryService mail;
    private final NotificationEventService notifications;
    private final NotificationService groupPush;

    public ReleasePrepService(ReleasePrepMapper prepMapper, ReleaseMapper releaseMapper,
                              ProjectAccessService access, ReleasePermissionService permissions,
                              WorkspaceMemberMapper memberMapper, UserMapper userMapper,
                              UserNotificationPreferenceService preferences, AppNotificationService inApp,
                              MailDeliveryService mail, NotificationEventService notifications,
                              NotificationService groupPush) {
        this.prepMapper = prepMapper;
        this.releaseMapper = releaseMapper;
        this.access = access;
        this.permissions = permissions;
        this.memberMapper = memberMapper;
        this.userMapper = userMapper;
        this.preferences = preferences;
        this.inApp = inApp;
        this.mail = mail;
        this.notifications = notifications;
        this.groupPush = groupPush;
    }

    /* ==================== 读：计划页汇总 ==================== */

    /** 计划详情「发布准备」卡：按人汇总、未指派、最近推送、我的状态。 */
    public Map<String, Object> summary(String userId, String workspaceId, String planId) {
        PlanContext ctx = requireView(userId, workspaceId, planId);
        List<TaskState> states = taskStates(ctx);
        Map<String, OwnerAgg> owners = aggregate(states);
        int ok = 0;
        int risk = 0;
        int unassigned = 0;
        int unconfirmed = 0;
        Set<String> pendingOwners = new LinkedHashSet<String>();
        LocalDateTime lastChecked = null;
        for (TaskState st : states) {
            boolean assigned = st.row.getOwnerUserId() != null;
            if (!assigned) unassigned++;
            if ("ok".equals(st.row.getCheckState())) ok++;
            else if ("risk".equals(st.row.getCheckState())) risk++;
            else if (assigned) {
                unconfirmed++;
                pendingOwners.add(st.row.getOwnerUserId());
            }
            if (st.row.getCheckedAt() != null
                    && (lastChecked == null || st.row.getCheckedAt().isAfter(lastChecked))) {
                lastChecked = st.row.getCheckedAt();
            }
        }
        int total = states.size();

        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("plan", planView(ctx));
        res.put("totalTasks", total);
        res.put("confirmedCount", ok);
        res.put("riskCount", risk);
        res.put("unconfirmedCount", unconfirmed);
        /* 通知动作按人计：一个负责人有多项未确认时只算 1 人 */
        res.put("unconfirmedOwnerCount", pendingOwners.size());
        res.put("unassignedCount", unassigned);
        res.put("lastCheckedAt", lastChecked);
        res.put("owners", ownerRows(owners));
        res.put("watcherCount", prepMapper.countWatchers(workspaceId, planId));
        res.put("watching", prepMapper.countMyWatch(workspaceId, planId, userId) > 0);
        res.put("canManage", canManage(userId, workspaceId, ctx.versions));
        res.put("latestPush", prepMapper.selectLatestPush(workspaceId, planId));
        res.put("myReceipt", prepMapper.selectMyReceipt(workspaceId, planId, userId));
        res.put("countdown", countdown(ctx.plan.getPlannedAt()));
        res.put("scopeToken", ctx.plan.getScopeToken());
        return res;
    }

    /** 通知成员弹窗：可选成员、任务数与未确认数；scope=all/owners/custom。 */
    public Map<String, Object> recipients(String userId, String workspaceId, String planId,
                                          String scope, String q, Boolean onlyUnconfirmed) {
        PlanContext ctx = requireView(userId, workspaceId, planId);
        List<TaskState> states = taskStates(ctx);
        Map<String, Integer> taskCount = new HashMap<String, Integer>();
        Map<String, Integer> unconfirmedCount = new HashMap<String, Integer>();
        Set<String> ownerIds = new LinkedHashSet<String>();
        for (TaskState st : states) {
            String owner = st.row.getOwnerUserId();
            if (owner == null) continue;
            ownerIds.add(owner);
            taskCount.merge(owner, 1, Integer::sum);
            if (!isFreshState(st.row)) unconfirmedCount.merge(owner, 1, Integer::sum);
        }
        String mode = normalizeScope(scope);
        /* 指定成员从全部可见成员里挑，不要求是工作项负责人；仅负责人范围才按负责人过滤 */
        List<WorkspaceMember> members;
        if ("owners".equals(mode)) {
            members = new ArrayList<WorkspaceMember>();
            for (WorkspaceMember m : memberMapper.selectByWorkspace(workspaceId)) {
                if (ownerIds.contains(m.getUserId())) members.add(m);
            }
        } else {
            members = memberMapper.selectByWorkspace(workspaceId);
        }
        String keyword = Texts.trimToNull(q);
        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>();
        for (WorkspaceMember m : members) {
            if (m.getUserId() == null || m.getRole() == null) continue;
            if (!visibleToPlan(workspaceId, m.getUserId(), ctx.versions)) continue;
            if (keyword != null) {
                String name = m.getDisplayName() == null ? "" : m.getDisplayName();
                if (!name.toLowerCase().contains(keyword.toLowerCase())) continue;
            }
            int mine = taskCount.getOrDefault(m.getUserId(), 0);
            int pending = unconfirmedCount.getOrDefault(m.getUserId(), 0);
            if (Boolean.TRUE.equals(onlyUnconfirmed) && pending == 0) continue;
            AppUser user = userMapper.selectById(m.getUserId());
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("userId", m.getUserId());
            item.put("name", m.getDisplayName());
            item.put("isOwner", ownerIds.contains(m.getUserId()));
            item.put("taskCount", mine);
            item.put("unconfirmedCount", pending);
            item.put("hasEmail", user != null && Texts.trimToNull(user.getEmail()) != null);
            item.put("inAppEnabled", preferences.inAppEnabled(m.getUserId(),
                    UserNotificationPreferenceService.RELEASE_PREP));
            item.put("emailEnabled", emailEnabled(m.getUserId()));
            items.add(item);
        }
        items.sort(Comparator
                .comparing((Map<String, Object> it) -> !Boolean.TRUE.equals(it.get("isOwner")))
                .thenComparing(it -> String.valueOf(it.get("name"))));
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("scope", mode);
        res.put("items", items);
        res.put("total", items.size());
        /* 前端预达人数必须知道 SMTP 是否真的启用，否则会把「有邮箱」误报成「邮件可达」 */
        res.put("emailAvailable", mail.isEnabled());
        return res;
    }

    /* ==================== 写：推送（含回执） ==================== */

    @Transactional
    public Map<String, Object> notify(String userId, String workspaceId, String planId,
                                      ReleasePrepNotifyRequest request) {
        PlanContext ctx = requireManage(userId, workspaceId, planId);
        List<TaskState> states = taskStates(ctx);
        String scope = normalizeScope(request == null ? null : request.getScope());
        boolean onlyUnconfirmed = request != null && Boolean.TRUE.equals(request.getOnlyUnconfirmed());
        List<String> channels = normalizeChannels(request == null ? null : request.getChannels());
        String note = normalizeNote(request == null ? null : request.getNote());
        if (channels.isEmpty()) {
            throw AppException.badRequest("请至少选择一个通知渠道");
        }
        Set<String> targetIds = resolveRecipients(workspaceId, ctx, states, scope,
                request == null ? null : request.getUserIds(), onlyUnconfirmed);
        if (targetIds.isEmpty()) {
            throw AppException.badRequest(onlyUnconfirmed
                    ? "没有符合条件的收件人：负责人均已确认或不在项目可见范围内"
                    : "没有符合条件的收件人，请调整范围或成员");
        }

        String channelText = toJsonArray(channels);
        String planLabel = planLabel(ctx);
        String title = "发布准备 · " + planLabel + countdownSuffix(ctx.plan.getPlannedAt());
        /* 事实句固定第一行；第二行按收件人给准备进度，补充说明顺延到可展开的第三行 */
        String baseBody = fmtTime(ctx.plan.getPlannedAt()) + " " + environmentName(ctx.plan.getEnvironment())
                + "发布；请确认你负责的工作项。点开逐项确认。";
        Map<String, OwnerPrepCounts> counts = ownerPrepCounts(states);
        /* 跨项目计划不固化项目：req_id 为空才不会被首个项目的可见性整条隐藏（sql/122） */
        String refReqId = planReqId(ctx.versions);

        /* 重复点击：同一发送人、同一范围/渠道，30 秒内直接复用上一批，不再重复打扰。
           先锁计划行，避免并发点击同时读到「无上一批」而各写一批。 */
        prepMapper.lockPlan(workspaceId, planId);
        ReleasePlanPush latest = prepMapper.selectLatestPush(workspaceId, planId);
        if (latest != null && userId.equals(latest.getSenderId())
                && scope.equals(latest.getScope())
                && channels.equals(parseChannels(latest.getChannels()))
                && sameText(note, latest.getNote())
                && onlyUnconfirmed == Boolean.TRUE.equals(latest.getOnlyUnconfirmed())
                && sameRecipients(prepMapper.selectPushRecipients(latest.getId()), targetIds)
                && latest.getCreatedAt() != null
                && latest.getCreatedAt().isAfter(LocalDateTime.now().minusSeconds(DUPLICATE_PUSH_WINDOW_SECONDS))) {
            Map<String, Object> dup = pushView(latest);
            dup.put("duplicate", Boolean.TRUE);
            return dup;
        }

        ReleasePlanPush push = new ReleasePlanPush();
        push.setId(Ids.gen("RPP"));
        push.setWorkspaceId(workspaceId);
        push.setPlanId(planId);
        push.setScope(scope);
        push.setSenderId(userId);
        push.setOnlyUnconfirmed(onlyUnconfirmed);
        push.setChannels(channelText);
        push.setNote(note);
        push.setRecipientCount(targetIds.size());
        if (prepMapper.insertPush(push) != 1) {
            throw new AppException(409, "推送批次写入冲突，请重试");
        }

        int inAppCount = 0;
        int emailCount = 0;
        for (String target : targetIds) {
            prepMapper.insertPushRecipient(push.getId(), workspaceId, target);
            if (channels.contains("in_app")
                    && preferences.inAppEnabled(target, UserNotificationPreferenceService.RELEASE_PREP)) {
                inApp.pushImmediate(target, workspaceId, UserNotificationPreferenceService.RELEASE_PREP,
                        title, personalBody(baseBody, counts.get(target), note), null, "release_plan", planId);
                prepMapper.markRecipientInApp(push.getId(), target);
                inAppCount++;
            }
            if (channels.contains("email") && emailEnabled(target)) {
                AppUser user = userMapper.selectById(target);
                /* 只有真的写入 outbox 才标记「已发邮件」：SMTP 未启用或写库失败时不能虚增人数 */
                if (user != null && Texts.trimToNull(user.getEmail()) != null
                        && mail.enqueue(user.getEmail(), title,
                        personalBody(baseBody, counts.get(target), note)
                                + deepLinkSuffix(refReqId, planId, ctx.versions, true),
                        UserNotificationPreferenceService.RELEASE_PREP, planId)) {
                    prepMapper.markRecipientEmail(push.getId(), target);
                    emailCount++;
                }
            }
        }
        Boolean groupSent = null;
        String groupSkipped = null;
        if (channels.contains("group")) {
            try {
                String groupText = title + "\n" + baseBody
                        + (note == null ? "" : "\n补充说明：" + note)
                        + deepLinkSuffix(refReqId, planId, ctx.versions, false);
                groupSent = groupPush.sendGroupEvent(workspaceId, groupText);
                if (!groupSent) {
                    groupSkipped = "该空间未启用外部推送，或群机器人发送失败";
                }
            } catch (Exception e) {
                groupSent = Boolean.FALSE;
                groupSkipped = "发送失败，详见服务日志";
                log.warn("发布准备群通知失败：workspace={} plan={}", workspaceId, planId, e);
            }
            push.setGroupSent(groupSent);
            push.setGroupError(groupSkipped);
            try {
                prepMapper.updatePushGroupResult(push.getId(), groupSent, groupSkipped);
            } catch (Exception e) {
                log.warn("发布准备群结果回写失败：plan={} push={}", planId, push.getId(), e);
            }
        }
        /* 按批次 ID 回读：同一秒内可能有其它批次，不能用「最新」猜本次结果 */
        ReleasePlanPush saved = prepMapper.selectPushById(workspaceId, planId, push.getId());
        Map<String, Object> res = pushView(saved == null ? push : saved);
        res.put("inAppCount", inAppCount);
        res.put("emailCount", emailCount);
        res.put("duplicate", Boolean.FALSE);
        if (groupSent != null) {
            res.put("groupSent", groupSent);
            if (groupSkipped != null) res.put("groupSkipped", groupSkipped);
        }
        log.info("发布准备推送：workspace={} plan={} sender={} scope={} recipients={} inApp={} email={} group={}",
                workspaceId, planId, userId, scope, targetIds.size(), inAppCount, emailCount, groupSent);
        return res;
    }

    /** 回执只认最近一次推送批次；重复回执幂等。 */
    @Transactional
    public Map<String, Object> ackReceipt(String userId, String workspaceId, String planId) {
        requireView(userId, workspaceId, planId);
        Map<String, Object> before = prepMapper.selectMyReceipt(workspaceId, planId, userId);
        if (before == null) {
            throw AppException.badRequest("没有需要回执的提醒：你可能不在最近一次推送范围内");
        }
        if (before.get("ackedAt") == null) {
            prepMapper.ackPushRecipient(workspaceId, planId, userId);
        }
        Map<String, Object> receipt = prepMapper.selectMyReceipt(workspaceId, planId, userId);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("receipt", receipt);
        return res;
    }

    /* ==================== 推送记录 ==================== */

    /** 计划页「推送记录」：最近的推送批次，含说明、渠道、群结果与回执人数。 */
    public Map<String, Object> pushHistory(String userId, String workspaceId, String planId, Integer limit) {
        requireView(userId, workspaceId, planId);
        int safeLimit = limit == null ? DEFAULT_PUSH_HISTORY
                : Math.max(1, Math.min(MAX_PUSH_HISTORY, limit));
        List<ReleasePlanPush> pushes = prepMapper.selectPushes(workspaceId, planId, safeLimit);
        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>();
        for (ReleasePlanPush push : pushes) items.add(pushView(push));
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("items", items);
        res.put("total", items.size());
        res.put("limit", safeLimit);
        return res;
    }

    /** 某一批推送的收件人与回执明细，用于「未回执名单」。 */
    public Map<String, Object> pushRecipients(String userId, String workspaceId, String planId, String pushId) {
        requireView(userId, workspaceId, planId);
        ReleasePlanPush push = prepMapper.selectPushById(workspaceId, planId, pushId);
        if (push == null) {
            throw AppException.notFound("推送记录不存在：" + pushId);
        }
        List<Map<String, Object>> rows = prepMapper.selectPushRecipientRows(pushId);
        int acked = 0;
        for (Map<String, Object> row : rows) {
            if (row.get("ackedAt") != null) acked++;
        }
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("push", pushView(push));
        res.put("items", rows);
        res.put("total", rows.size());
        res.put("ackedCount", acked);
        res.put("unackedCount", Math.max(0, rows.size() - acked));
        return res;
    }

    /* ==================== 我的发布准备 ==================== */

    /** 通知深链落地页：只返回我负责的工作项、我的确认与回执。 */
    public Map<String, Object> myPrep(String userId, String workspaceId, String planId) {
        PlanContext ctx = requireView(userId, workspaceId, planId);
        List<TaskState> states = taskStates(ctx);
        String me = displayName(userId);
        List<ReleasePrepTaskRow> mine = new ArrayList<ReleasePrepTaskRow>();
        int ok = 0;
        int risk = 0;
        for (TaskState st : states) {
            if (!isMine(st.row, userId, me)) continue;
            mine.add(st.row);
            if ("ok".equals(st.row.getCheckState())) ok++;
            if ("risk".equals(st.row.getCheckState())) risk++;
        }
        Map<String, Object> receipt = prepMapper.selectMyReceipt(workspaceId, planId, userId);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("plan", planView(ctx));
        res.put("items", mine);
        res.put("totalMine", mine.size());
        res.put("checkedMine", ok);
        res.put("riskMine", risk);
        res.put("pendingMine", Math.max(0, mine.size() - ok - risk));
        res.put("receipt", receipt);
        res.put("watching", prepMapper.countMyWatch(workspaceId, planId, userId) > 0);
        res.put("watcherCount", prepMapper.countWatchers(workspaceId, planId));
        res.put("canManage", canManage(userId, workspaceId, ctx.versions));
        res.put("countdown", countdown(ctx.plan.getPlannedAt()));
        res.put("scopeToken", ctx.plan.getScopeToken());
        return res;
    }

    @Transactional
    public Map<String, Object> check(String userId, String workspaceId, String planId, String taskId,
                                     ReleasePrepCheckRequest request) {
        PlanContext ctx = requireView(userId, workspaceId, planId);
        String state = request == null ? null : Texts.trimToNull(request.getState());
        if (!"ok".equals(state) && !"risk".equals(state)) {
            throw AppException.badRequest("确认状态只能是已确认或有风险");
        }
        String expected = request == null ? null : Texts.trimToNull(request.getExpectedScopeToken());
        if (expected != null && !expected.equals(ctx.plan.getScopeToken())) {
            throw new AppException(409, "计划范围或时间已变化，请刷新后重新确认");
        }
        TaskState target = null;
        for (TaskState st : taskStates(ctx)) {
            if (st.row.getId().equals(taskId)) {
                target = st;
                break;
            }
        }
        if (target == null) {
            throw AppException.notFound("工作项不在当前发布计划范围：" + taskId);
        }
        if (target.row.getOwnerUserId() == null) {
            throw AppException.badRequest("未指派负责人的工作项不能逐项确认");
        }
        if (!userId.equals(target.row.getOwnerUserId())) {
            throw new AppException(403, "只能确认自己负责的工作项");
        }
        String note = request == null ? null : Texts.trimToNull(request.getNote());
        if (note != null && note.length() > 500) {
            throw AppException.badRequest("风险说明不能超过 500 字");
        }
        ReleasePlanTaskCheck check = new ReleasePlanTaskCheck();
        check.setWorkspaceId(workspaceId);
        check.setPlanId(planId);
        check.setTaskId(taskId);
        check.setUserId(userId);
        check.setState(state);
        check.setNote(note);
        check.setScopeToken(ctx.plan.getScopeToken());
        check.setPlannedAtSnapshot(ctx.plan.getPlannedAt());
        prepMapper.upsertCheck(check);
        return checkResponse(userId, workspaceId, planId);
    }

    @Transactional
    public Map<String, Object> undoCheck(String userId, String workspaceId, String planId, String taskId) {
        requireView(userId, workspaceId, planId);
        prepMapper.deleteCheck(workspaceId, planId, taskId, userId);
        return checkResponse(userId, workspaceId, planId);
    }

    private Map<String, Object> checkResponse(String userId, String workspaceId, String planId) {
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("me", myPrep(userId, workspaceId, planId));
        res.put("summary", summary(userId, workspaceId, planId));
        return res;
    }

    /* ==================== 关注 ==================== */

    public Map<String, Object> watchStatus(String userId, String workspaceId, String planId) {
        PlanContext ctx = requireView(userId, workspaceId, planId);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("watching", prepMapper.countMyWatch(workspaceId, planId, userId) > 0);
        res.put("count", prepMapper.countWatchers(workspaceId, planId));
        res.put("canManage", canManage(userId, workspaceId, ctx.versions));
        return res;
    }

    @Transactional
    public Map<String, Object> watch(String userId, String workspaceId, String planId) {
        requireView(userId, workspaceId, planId);
        prepMapper.insertWatchIgnore(workspaceId, planId, userId);
        return watchStatus(userId, workspaceId, planId);
    }

    @Transactional
    public Map<String, Object> unwatch(String userId, String workspaceId, String planId) {
        requireView(userId, workspaceId, planId);
        prepMapper.deleteWatch(workspaceId, planId, userId);
        return watchStatus(userId, workspaceId, planId);
    }

    public int countMyWatchedPlans(String workspaceId, String userId) {
        return prepMapper.countMyWatchedPlans(workspaceId, userId, access.viewerScope(workspaceId, userId));
    }

    /** 我的工作 → 我的关注：发布计划分页。 */
    public Map<String, Object> myWatchedPlans(String workspaceId, String userId, int offset, int limit) {
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, limit));
        String viewerId = access.viewerScope(workspaceId, userId);
        int total = prepMapper.countMyWatchedPlans(workspaceId, userId, viewerId);
        List<ReleasePlanWatchRow> items = total <= safeOffset
                ? new ArrayList<ReleasePlanWatchRow>()
                : prepMapper.selectMyWatchedPlans(workspaceId, userId, viewerId, safeOffset, safeLimit);
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("items", items);
        res.put("total", total);
        res.put("offset", safeOffset);
        res.put("limit", safeLimit);
        res.put("hasMore", safeOffset + items.size() < total);
        res.put("updatedAt", LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));
        return res;
    }

    /** 计划改期 / 范围变化 / 进入就绪时通知关注者；由保存计划的同一事务在写完后调用。 */
    public void notifyPlanChanged(String actorId, String workspaceId, VersionReleasePlan before, VersionReleasePlan after) {
        if (before == null || after == null) return;
        List<String> changes = describeChanges(before, after);
        if (changes.isEmpty()) return;
        List<PlanVersionRow> versions = releaseMapper.selectPlanVersions(workspaceId, after.getId());
        String title = "发布计划有更新 · " + planLabel(after);
        String body = "「" + planLabel(after) + "」" + String.join("；", changes) + "。";
        for (String watcherId : prepMapper.selectWatcherIds(workspaceId, after.getId())) {
            if (watcherId == null || watcherId.equals(actorId)) continue;
            if (!visibleToPlan(workspaceId, watcherId, versions)) continue;
            try {
                /* 计划可跨项目：落一个该接收人确实能看到的项目 req_id，项目被隐藏后通知才会一起隐藏 */
                String reqId = visibleReqId(workspaceId, watcherId, versions);
                notifications.notifyLinked(watcherId, workspaceId,
                        UserNotificationPreferenceService.RELEASE_WATCH, title, body,
                        "release_plan", after.getId(), reqId,
                        deepLinkSuffix(reqId, after.getId(), versions, false));
            } catch (Exception e) {
                log.warn("发布计划关注通知失败（不影响主流程）：plan={} user={}", after.getId(), watcherId, e);
            }
        }
    }

    /**
     * 已取消的计划仍发生了成功的生产发布：状态保持取消（取消是人的决定，发布是外部事实），
     * 只提醒关注者与计划负责人，避免「计划取消了却悄悄交付」无人知晓。
     */
    public void notifyCanceledPlanReleased(String actorId, String workspaceId, VersionReleasePlan plan) {
        if (plan == null) return;
        List<PlanVersionRow> versions = releaseMapper.selectPlanVersions(workspaceId, plan.getId());
        String title = "已取消计划发生了发布 · " + planLabel(plan);
        String body = "「" + planLabel(plan) + "」已取消，但本次成功生产发布已记录；计划状态保持「已取消」，"
                + "如需继续交付请新建计划。";
        Set<String> recipients = new LinkedHashSet<String>();
        if (Texts.trimToNull(plan.getOwnerUserId()) != null) recipients.add(plan.getOwnerUserId());
        recipients.addAll(prepMapper.selectWatcherIds(workspaceId, plan.getId()));
        for (String target : recipients) {
            if (target == null || target.equals(actorId)) continue;
            if (!visibleToPlan(workspaceId, target, versions)) continue;
            try {
                String reqId = visibleReqId(workspaceId, target, versions);
                notifications.notifyLinked(target, workspaceId,
                        UserNotificationPreferenceService.RELEASE_WATCH, title, body,
                        "release_plan", plan.getId(), reqId,
                        deepLinkSuffix(reqId, plan.getId(), versions, false));
            } catch (Exception e) {
                log.warn("已取消计划发布事实通知失败（不影响主流程）：plan={} user={}", plan.getId(), target, e);
            }
        }
    }

    /**
     * 每日 09:05 里程碑扫描。
     * T-7/T-3/T-1 只发给「有未确认工作项且未回执」的负责人；T-0 发给计划负责人与关注者。
     * version_release_plan_milestone 唯一键保证同一人同一里程碑只发一次，改期后按新日期重新计算。
     */
    public void scanMilestones(LocalDate today) {
        for (String milestone : Arrays.asList("T-7", "T-3", "T-1", "T-0")) {
            LocalDate target = "T-7".equals(milestone) ? today.plusDays(7)
                    : "T-3".equals(milestone) ? today.plusDays(3)
                    : "T-1".equals(milestone) ? today.plusDays(1) : today;
            /* T-7/T-3/T-1 留一天补发窗口：当天发送失败不落记录，次日仍会命中；
               T-0 只认当天，避免发布日之后仍在提醒。唯一键保证同一里程碑不会重复发送。 */
            LocalDate from = "T-0".equals(milestone) ? target : target.minusDays(1);
            List<Map<String, Object>> plans;
            try {
                plans = prepMapper.selectPlansForMilestone(from.atStartOfDay(), target.plusDays(1).atStartOfDay());
            } catch (Exception e) {
                log.warn("发布准备里程碑扫描失败：milestone={} date={}", milestone, target, e);
                continue;
            }
            for (Map<String, Object> row : plans) {
                try {
                    sendMilestone(today, milestone, row);
                } catch (Exception e) {
                    log.warn("发布准备里程碑发送失败：milestone={} plan={}", milestone, mapString(row, "planId"), e);
                }
            }
        }
    }

    /** 计划改期后清空里程碑记录，新日期上的 T-7/T-3/T-1/T-0 重新计算。 */
    public void resetMilestones(String workspaceId, String planId) {
        prepMapper.deleteMilestones(workspaceId, planId);
    }

    private void sendMilestone(LocalDate today, String milestone, Map<String, Object> row) {
        String planId = mapString(row, "planId");
        String workspaceId = mapString(row, "workspaceId");
        if (planId == null || workspaceId == null) return;
        PlanContext ctx;
        try {
            VersionReleasePlan plan = prepMapper.selectPlan(workspaceId, planId);
            if (plan == null) return;
            List<PlanVersionRow> versions = releaseMapper.selectPlanVersions(workspaceId, planId);
            ctx = new PlanContext(plan, versions);
        } catch (Exception e) {
            log.warn("发布准备里程碑读取计划失败：plan={}", planId, e);
            return;
        }
        List<TaskState> states = taskStates(ctx);
        Map<String, OwnerPrepCounts> counts = ownerPrepCounts(states);
        String label = planLabel(ctx);
        String facts = fmtTime(ctx.plan.getPlannedAt()) + " " + environmentName(ctx.plan.getEnvironment()) + "发布";
        String title;
        String body;
        String eventType;
        boolean prepLink;
        Set<String> recipients = new LinkedHashSet<String>();
        if ("T-0".equals(milestone)) {
            title = "今天发布 · " + label;
            body = facts + "，请留意发布结果与回滚预案。";
            eventType = UserNotificationPreferenceService.RELEASE_WATCH;
            prepLink = false;
            if (Texts.trimToNull(ctx.plan.getOwnerUserId()) != null) {
                recipients.add(ctx.plan.getOwnerUserId());
            }
            recipients.addAll(prepMapper.selectWatcherIds(workspaceId, planId));
        } else {
            title = "发布准备待确认 · " + label + countdownSuffix(ctx.plan.getPlannedAt());
            LocalDate planDate = planDate(row);
            long days = planDate == null ? Long.parseLong(milestone.substring(2))
                    : ChronoUnit.DAYS.between(today, planDate);
            String when = days <= 0 ? "即将发布" : "距离发布还有 " + days + " 天";
            body = facts + "；" + when + "，请确认你负责的工作项。";
            eventType = UserNotificationPreferenceService.RELEASE_PREP;
            prepLink = true;
            for (TaskState st : states) {
                String owner = st.row.getOwnerUserId();
                if (owner == null || isFreshState(st.row)) continue;
                Map<String, Object> receipt = prepMapper.selectMyReceipt(workspaceId, planId, owner);
                if (receipt != null && receipt.get("ackedAt") != null) continue;
                recipients.add(owner);
            }
        }
        for (String target : recipients) {
            if (target == null) continue;
            if (!visibleToPlan(workspaceId, target, ctx.versions)) continue;
            if (prepMapper.insertMilestoneIgnore(workspaceId, planId, target, milestone) != 1) continue;
            boolean delivered;
            try {
                /* 计划可能跨项目：落一个接收人可见的项目 req_id，项目被隐藏后通知才会一起隐藏 */
                String reqId = visibleReqId(workspaceId, target, ctx.versions);
                String personal = eventType == UserNotificationPreferenceService.RELEASE_PREP
                        ? personalBody(body, counts.get(target), null) : body;
                delivered = notifications.notifyLinked(target, workspaceId, eventType, title, personal,
                        "release_plan", planId, reqId,
                        deepLinkSuffix(reqId, planId, ctx.versions, prepLink));
            } catch (Exception e) {
                delivered = false;
                log.warn("发布准备里程碑通知失败：plan={} user={} milestone={}", planId, target, milestone, e);
            }
            if (!delivered) {
                /* 没送出去就不能留下「已发送」记录，否则补发窗口内也不会再命中 */
                prepMapper.deleteMilestone(workspaceId, planId, target, milestone);
                log.warn("发布准备里程碑未送达，已撤回发送记录：plan={} user={} milestone={}", planId, target, milestone);
            }
        }
    }

    /** 里程碑扫描行里的计划时间：MyBatis map 里可能是 LocalDateTime 或 java.sql.Timestamp。 */
    private static LocalDate planDate(Map<String, Object> row) {
        Object value = row == null ? null : row.get("plannedAt");
        if (value == null && row != null) value = row.get("plannedat");
        if (value instanceof LocalDateTime) return ((LocalDateTime) value).toLocalDate();
        if (value instanceof java.sql.Timestamp) return ((java.sql.Timestamp) value).toLocalDateTime().toLocalDate();
        if (value instanceof LocalDate) return (LocalDate) value;
        return null;
    }

    /* ==================== 计划读取与权限 ==================== */

    private static final class PlanContext {
        private final VersionReleasePlan plan;
        private final List<PlanVersionRow> versions;

        private PlanContext(VersionReleasePlan plan, List<PlanVersionRow> versions) {
            this.plan = plan;
            this.versions = versions == null ? Collections.<PlanVersionRow>emptyList() : versions;
        }
    }

    private PlanContext loadPlan(String workspaceId, String planId) {
        String id = Texts.trimToNull(planId);
        if (id == null) throw AppException.badRequest("请选择发布计划");
        VersionReleasePlan plan = prepMapper.selectPlan(workspaceId, id);
        if (plan == null) {
            throw AppException.notFound("发布计划不存在：" + id);
        }
        return new PlanContext(plan, releaseMapper.selectPlanVersions(workspaceId, id));
    }

    /** 计划可见 = 至少一个计划项目可见；全不可见按不存在处理，避免泄露计划是否存在。 */
    private PlanContext requireView(String userId, String workspaceId, String planId) {
        PlanContext ctx = loadPlan(workspaceId, planId);
        if (!visibleToPlan(workspaceId, userId, ctx.versions)) {
            throw AppException.notFound("发布计划不存在或你没有访问权限");
        }
        return ctx;
    }

    /** 推送/提醒沿用发布计划管理权限：计划涉及的每个项目都要可管理。 */
    private PlanContext requireManage(String userId, String workspaceId, String planId) {
        PlanContext ctx = requireView(userId, workspaceId, planId);
        if (!canManage(userId, workspaceId, ctx.versions)) {
            throw new AppException(403, "仅空间主、管理员或项目负责人可发送发布准备提醒");
        }
        return ctx;
    }

    private boolean canManage(String userId, String workspaceId, List<PlanVersionRow> versions) {
        if (versions.isEmpty()) return false;
        for (PlanVersionRow row : versions) {
            if (!permissions.canManageProject(userId, workspaceId, row.getReqId())) {
                return false;
            }
        }
        return true;
    }

    private boolean visibleToPlan(String workspaceId, String userId, List<PlanVersionRow> versions) {
        for (PlanVersionRow row : versions) {
            if (access.canView(workspaceId, userId, row.getReqId())) {
                return true;
            }
        }
        return versions.isEmpty() && access.canView(workspaceId, userId, null);
    }

    /** 通知写入的 req_id：取接收人可见的第一个计划项目；都不可见时返回 null（调用方已先做过可见性过滤）。 */
    private String visibleReqId(String workspaceId, String userId, List<PlanVersionRow> versions) {
        for (PlanVersionRow row : versions) {
            if (access.canView(workspaceId, userId, row.getReqId())) {
                return row.getReqId();
            }
        }
        return null;
    }

    /* ==================== 任务状态与汇总 ==================== */

    private static final class TaskState {
        private final ReleasePrepTaskRow row;

        private TaskState(ReleasePrepTaskRow row) {
            this.row = row;
        }
    }

    private static final class OwnerPrepCounts {
        private int total;
        private int unfinished;
        private int risk;
        private int unconfirmed;
    }

    /** 只把「当前负责人 + 当前范围」的确认算数；范围变了或计划时间提前，旧确认标记为待重新确认。 */
    private List<TaskState> taskStates(PlanContext ctx) {
        List<ReleasePrepTaskRow> rows = prepMapper.selectPlanTaskRows(ctx.plan.getWorkspaceId(), ctx.plan.getId());
        Map<String, ReleasePlanTaskCheck> byTaskOwner = new HashMap<String, ReleasePlanTaskCheck>();
        for (ReleasePlanTaskCheck check : prepMapper.selectChecks(ctx.plan.getWorkspaceId(), ctx.plan.getId())) {
            if (check.getTaskId() != null && check.getUserId() != null) {
                byTaskOwner.put(check.getTaskId() + "\u0000" + check.getUserId(), check);
            }
        }
        List<TaskState> states = new ArrayList<TaskState>();
        for (ReleasePrepTaskRow row : rows) {
            ReleasePlanTaskCheck check = row.getOwnerUserId() == null ? null
                    : byTaskOwner.get(row.getId() + "\u0000" + row.getOwnerUserId());
            if (check != null) {
                boolean stale = stale(ctx.plan, check);
                row.setStale(stale);
                row.setCheckState(stale ? null : check.getState());
                row.setCheckNote(check.getNote());
                row.setCheckedAt(check.getCheckedAt());
            } else {
                row.setStale(Boolean.FALSE);
                row.setCheckState(null);
            }
            states.add(new TaskState(row));
        }
        return states;
    }

    private boolean stale(VersionReleasePlan plan, ReleasePlanTaskCheck check) {
        if (check.getScopeToken() != null && !check.getScopeToken().equals(plan.getScopeToken())) {
            return true;
        }
        return check.getPlannedAtSnapshot() != null && plan.getPlannedAt() != null
                && check.getPlannedAtSnapshot().isAfter(plan.getPlannedAt());
    }

    private boolean isFreshState(ReleasePrepTaskRow row) {
        return "ok".equals(row.getCheckState()) || "risk".equals(row.getCheckState());
    }

    private boolean isMine(ReleasePrepTaskRow row, String userId, String displayName) {
        if (userId != null && userId.equals(row.getOwnerUserId())) return true;
        return row.getOwnerUserId() == null && displayName != null
                && displayName.equals(Texts.trimToNull(row.getOwnerName()));
    }

    private static final class OwnerAgg {
        private final String userId;
        private final String name;
        private int total;
        private int ok;
        private int risk;
        private int pending;
        private int unfinished;
        private LocalDateTime lastChecked;
        private final Set<String> projects = new LinkedHashSet<String>();

        private OwnerAgg(String userId, String name) {
            this.userId = userId;
            this.name = name;
        }
    }

    private Map<String, OwnerAgg> aggregate(List<TaskState> states) {
        Map<String, OwnerAgg> owners = new LinkedHashMap<String, OwnerAgg>();
        for (TaskState st : states) {
            String key = st.row.getOwnerUserId() == null ? "__unassigned__" : st.row.getOwnerUserId();
            OwnerAgg agg = owners.get(key);
            if (agg == null) {
                agg = new OwnerAgg(st.row.getOwnerUserId(),
                        st.row.getOwnerUserId() == null ? "未指派" : st.row.getOwnerName());
                owners.put(key, agg);
            }
            agg.total++;
            if (!"done".equals(st.row.getBoardColumn())) agg.unfinished++;
            if ("ok".equals(st.row.getCheckState())) agg.ok++;
            else if ("risk".equals(st.row.getCheckState())) agg.risk++;
            else agg.pending++;
            if (st.row.getCheckedAt() != null
                    && (agg.lastChecked == null || st.row.getCheckedAt().isAfter(agg.lastChecked))) {
                agg.lastChecked = st.row.getCheckedAt();
            }
            if (Texts.trimToNull(st.row.getProjectName()) != null) {
                agg.projects.add(st.row.getProjectName());
            }
        }
        return owners;
    }

    private List<Map<String, Object>> ownerRows(Map<String, OwnerAgg> owners) {
        List<OwnerAgg> sorted = new ArrayList<OwnerAgg>(owners.values());
        sorted.sort(Comparator
                .comparing((OwnerAgg o) -> o.userId == null)
                .thenComparing(o -> o.name == null ? "" : o.name));
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        for (OwnerAgg o : sorted) {
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("userId", o.userId);
            row.put("name", o.name);
            row.put("total", o.total);
            row.put("confirmed", o.ok);
            row.put("risk", o.risk);
            row.put("pending", o.pending);
            row.put("unfinished", o.unfinished);
            row.put("lastCheckedAt", o.lastChecked);
            row.put("projectNames", String.join("、", o.projects));
            rows.add(row);
        }
        return rows;
    }

    private Map<String, Object> planView(PlanContext ctx) {
        VersionReleasePlan plan = ctx.plan;
        Set<String> projectNames = new LinkedHashSet<String>();
        Set<String> versionNames = new LinkedHashSet<String>();
        for (PlanVersionRow row : ctx.versions) {
            if (Texts.trimToNull(row.getProjectName()) != null) projectNames.add(row.getProjectName());
            if (Texts.trimToNull(row.getVersionName()) != null) versionNames.add(row.getVersionName());
        }
        Map<String, Object> view = new LinkedHashMap<String, Object>();
        view.put("id", plan.getId());
        view.put("planNo", plan.getPlanNo());
        view.put("versionId", ctx.versions.isEmpty() ? plan.getVersionId() : ctx.versions.get(0).getVersionId());
        view.put("reqId", ctx.versions.isEmpty() ? null : ctx.versions.get(0).getReqId());
        view.put("plannedAt", plan.getPlannedAt());
        view.put("ownerUserId", plan.getOwnerUserId());
        view.put("ownerName", displayName(plan.getOwnerUserId()));
        view.put("status", plan.getStatus());
        view.put("environment", plan.getEnvironment());
        view.put("coverage", plan.getCoverage());
        view.put("notes", plan.getNotes());
        view.put("risks", plan.getRisks());
        view.put("versionCount", ctx.versions.size());
        view.put("projectNames", String.join("、", projectNames));
        view.put("versionNames", String.join("、", versionNames));
        return view;
    }

    /* ==================== 收件人解析 ==================== */

    private Set<String> resolveRecipients(String workspaceId, PlanContext ctx, List<TaskState> states,
                                          String scope, List<String> requested, boolean onlyUnconfirmed) {
        Set<String> ids = new LinkedHashSet<String>();
        if ("owners".equals(scope)) {
            for (TaskState st : states) {
                if (st.row.getOwnerUserId() != null) ids.add(st.row.getOwnerUserId());
            }
        } else if ("custom".equals(scope)) {
            if (requested != null) {
                for (String raw : requested) {
                    String id = Texts.trimToNull(raw);
                    if (id == null) continue;
                    WorkspaceMember m = memberMapper.selectMember(workspaceId, id);
                    if (m != null && m.getRole() != null && visibleToPlan(workspaceId, id, ctx.versions)) {
                        ids.add(id);
                    }
                }
            }
        } else {
            for (WorkspaceMember m : memberMapper.selectByWorkspace(workspaceId)) {
                if (m.getUserId() != null && m.getRole() != null
                        && visibleToPlan(workspaceId, m.getUserId(), ctx.versions)) {
                    ids.add(m.getUserId());
                }
            }
        }
        if (!onlyUnconfirmed) return ids;
        Set<String> pendingOwners = new HashSet<String>();
        for (TaskState st : states) {
            if (st.row.getOwnerUserId() != null && !isFreshState(st.row)) {
                pendingOwners.add(st.row.getOwnerUserId());
            }
        }
        ids.retainAll(pendingOwners);
        return ids;
    }

    /* ==================== 小工具 ==================== */

    private String normalizeScope(String scope) {
        String s = Texts.trimToNull(scope);
        if (s == null) return "all";
        if (!"all".equals(s) && !"owners".equals(s) && !"custom".equals(s)) {
            throw AppException.badRequest("通知范围只能是全部成员、仅负责人或指定成员");
        }
        return s;
    }

    /** 补充说明统一成单行纯文本：站内/邮件/群共用一段，长度按字符数校验。 */
    private String normalizeNote(String raw) {
        String s = Texts.trimToNull(raw);
        if (s == null) return null;
        s = s.replaceAll("\\s+", " ").trim();
        if (s.length() > MAX_NOTE) {
            throw AppException.badRequest("补充说明不能超过 " + MAX_NOTE + " 字");
        }
        return s;
    }

    private List<String> normalizeChannels(List<String> channels) {
        Set<String> chosen = new HashSet<String>();
        if (channels == null || channels.isEmpty()) {
            chosen.addAll(DEFAULT_CHANNELS);
        } else {
            for (String raw : channels) {
                String c = Texts.trimToNull(raw);
                if (c == null) continue;
                if (!CHANNELS.contains(c)) {
                    throw AppException.badRequest("通知渠道只能是站内、邮件或企业微信群");
                }
                chosen.add(c);
            }
        }
        /* 按固定渠道顺序输出：去重比较时与 parseChannels 的读取顺序一致，前端勾选顺序不同不算新一批 */
        List<String> result = new ArrayList<String>();
        for (String channel : CHANNELS) {
            if (chosen.contains(channel)) result.add(channel);
        }
        return result;
    }

    private List<String> parseChannels(String json) {
        List<String> result = new ArrayList<String>();
        if (json == null) return result;
        for (String channel : CHANNELS) {
            if (json.contains("\"" + channel + "\"")) result.add(channel);
        }
        return result;
    }

    private String toJsonArray(List<String> values) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(values.get(i)).append('"');
        }
        return sb.append(']').toString();
    }

    private Map<String, Object> pushView(ReleasePlanPush push) {
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("pushId", push.getId());
        res.put("scope", push.getScope());
        res.put("senderName", push.getSenderName());
        res.put("onlyUnconfirmed", Boolean.TRUE.equals(push.getOnlyUnconfirmed()));
        res.put("channels", parseChannels(push.getChannels()));
        res.put("note", push.getNote());
        res.put("recipientCount", push.getRecipientCount());
        res.put("groupSent", push.getGroupSent());
        res.put("groupError", push.getGroupError());
        res.put("inAppCount", push.getInAppCount());
        res.put("emailCount", push.getEmailCount());
        res.put("ackedCount", push.getAckedCount());
        res.put("createdAt", push.getCreatedAt());
        return res;
    }

    private List<String> describeChanges(VersionReleasePlan before, VersionReleasePlan after) {
        List<String> changes = new ArrayList<String>();
        if (!sameTime(before.getPlannedAt(), after.getPlannedAt())) {
            changes.add("发布时间调整为 " + fmtTime(after.getPlannedAt()));
        }
        if (!sameSet(before.getVersionIds(), after.getVersionIds())) {
            changes.add("计划版本范围已变化");
        }
        if (!sameSet(before.getTargetKeys(), after.getTargetKeys())) {
            changes.add("发布目标已变化");
        }
        if (!sameText(before.getEnvironment(), after.getEnvironment())) {
            changes.add("发布环境调整为 " + (after.getEnvironment() == null ? "未填写" : after.getEnvironment()));
        }
        if (!sameText(before.getCoverage(), after.getCoverage())) {
            changes.add("覆盖范围已变化");
        }
        if (!"ready".equals(before.getStatus()) && "ready".equals(after.getStatus())) {
            changes.add("计划已进入就绪");
        }
        return changes;
    }

    private boolean sameTime(LocalDateTime a, LocalDateTime b) {
        if (a == null) return b == null;
        return a.equals(b);
    }

    private boolean sameSet(List<String> a, List<String> b) {
        Set<String> sa = a == null ? Collections.<String>emptySet() : new HashSet<String>(a);
        Set<String> sb = b == null ? Collections.<String>emptySet() : new HashSet<String>(b);
        return sa.equals(sb);
    }

    private boolean sameText(String a, String b) {
        return Texts.trimToNull(a) == null ? Texts.trimToNull(b) == null
                : Texts.trimToNull(a).equals(Texts.trimToNull(b));
    }

    /** 30 秒去重必须同一批收件人：指定成员从 A 改成 B 时不能复用上一条。 */
    private boolean sameRecipients(List<String> existing, Set<String> targets) {
        if (existing == null || existing.isEmpty()) return targets.isEmpty();
        if (existing.size() != targets.size()) return false;
        return targets.containsAll(existing);
    }

    private boolean emailEnabled(String userId) {
        try {
            return Boolean.TRUE.equals(preferences.get(userId,
                    UserNotificationPreferenceService.RELEASE_PREP).getEmail());
        } catch (Exception e) {
            return false;
        }
    }

    private String planLabel(VersionReleasePlan plan) {
        if (plan == null) return "发布计划";
        if (plan.getPlanNo() != null) {
            return "PL-" + (plan.getPlanNo() < 100 ? (plan.getPlanNo() < 10 ? "00" : "0") : "") + plan.getPlanNo();
        }
        return "发布计划";
    }

    private String planLabel(PlanContext ctx) {
        if (ctx == null || ctx.plan == null) return "发布计划";
        String label = planLabel(ctx.plan);
        if (!ctx.versions.isEmpty()) {
            List<String> names = new ArrayList<String>();
            for (PlanVersionRow row : ctx.versions) {
                if (Texts.trimToNull(row.getVersionName()) != null) names.add(row.getVersionName());
            }
            if (!names.isEmpty()) {
                return label + " · " + String.join("、", names);
            }
        }
        return label;
    }

    private String fmtTime(LocalDateTime time) {
        return time == null ? "未定时间" : time.format(MINUTE);
    }

    /** 与前端 releaseEnvironmentName 保持同一套显示名，通知里不能出现 production 这类原始值 */
    private String environmentName(String environment) {
        String env = Texts.trimToNull(environment);
        if (env == null) return "未记录环境";
        if ("production".equals(env)) return "生产";
        if ("staging".equals(env)) return "预发布";
        if ("test".equals(env)) return "测试";
        return env;
    }

    /** 通知固化的项目：只覆盖一个项目时才写 req_id；跨项目计划保持为空，避免被单个项目的可见性隐藏。 */
    private String planReqId(List<PlanVersionRow> versions) {
        String only = null;
        for (PlanVersionRow row : versions) {
            String reqId = Texts.trimToNull(row.getReqId());
            if (reqId == null) continue;
            if (only == null) only = reqId;
            else if (!only.equals(reqId)) return null;
        }
        return only;
    }

    /** 通知标题里的倒计时后缀；未定时间时不加，保持标题可读。 */
    private String countdownSuffix(LocalDateTime plannedAt) {
        if (plannedAt == null) return "";
        long days = ChronoUnit.DAYS.between(LocalDate.now(), plannedAt.toLocalDate());
        if (days == 0) return " · 今天发布";
        return days > 0 ? " · " + days + " 天后" : " · 已过 " + (-days) + " 天";
    }

    /** 每个负责人在本计划内的准备进度：有风险 > 待确认 > 未完成 互斥归类，已完成的全部确认不占桶。 */
    private Map<String, OwnerPrepCounts> ownerPrepCounts(List<TaskState> states) {
        Map<String, OwnerPrepCounts> res = new HashMap<String, OwnerPrepCounts>();
        for (TaskState st : states) {
            String owner = st.row.getOwnerUserId();
            if (owner == null) continue;
            OwnerPrepCounts c = res.get(owner);
            if (c == null) {
                c = new OwnerPrepCounts();
                res.put(owner, c);
            }
            c.total++;
            if ("risk".equals(st.row.getCheckState())) c.risk++;
            else if (!isFreshState(st.row)) c.unconfirmed++;
            else if (!"done".equals(st.row.getBoardColumn())) c.unfinished++;
        }
        return res;
    }

    /** 站内/邮件正文第二行；群消息没有具体收件人，不调用这里。 */
    private String personalBody(String baseBody, OwnerPrepCounts counts, String note) {
        String line;
        if (counts == null || counts.total == 0) {
            line = "你没有负责本计划的工作项，请知悉发布安排。";
        } else {
            List<String> parts = new ArrayList<String>();
            if (counts.unfinished > 0) parts.add(counts.unfinished + " 未完成");
            if (counts.risk > 0) parts.add(counts.risk + " 有风险");
            if (counts.unconfirmed > 0) parts.add(counts.unconfirmed + " 待确认");
            line = parts.isEmpty()
                    ? "你负责的 " + counts.total + " 项已全部确认。"
                    : "你负责 " + counts.total + " 项：" + String.join("、", parts) + "。";
        }
        String body = baseBody + "\n" + line;
        return note == null ? body : body + "\n补充说明：" + note;
    }

    private Map<String, Object> countdown(LocalDateTime plannedAt) {
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        if (plannedAt == null) {
            res.put("daysLeft", null);
            res.put("text", "未定时间");
            res.put("overdue", Boolean.FALSE);
            return res;
        }
        long days = ChronoUnit.DAYS.between(LocalDate.now(), plannedAt.toLocalDate());
        String text = days == 0 ? "今天发布" : days > 0 ? "还有 " + days + " 天" : "已过 " + (-days) + " 天";
        res.put("daysLeft", days);
        res.put("text", text);
        res.put("overdue", days < 0);
        return res;
    }

    private String displayName(String userId) {
        if (userId == null) return null;
        AppUser user = userMapper.selectById(userId);
        return user == null ? null : user.getDisplayName();
    }

    /**
     * 邮件/群消息里的发布计划深链。
     *
     * @param prep true 时落「我的发布准备」（仅发给负责人的场景）；群消息没有具体人，不能带
     */
    private String deepLinkSuffix(String reqId, String planId, List<PlanVersionRow> versions, boolean prep) {
        String base = Texts.trimToNull(mailBaseUrl);
        if (base == null || versions == null || versions.isEmpty()) return "";
        if (!base.endsWith("/")) base = base + "/";
        String versionId = versions.get(0).getVersionId();
        String req = Texts.trimToNull(reqId);
        return "\n\n打开发布计划：" + base + "#/release?id=" + versionId
                + (req == null ? "" : "&reqId=" + req) + "&plan=" + planId + "&tab=plan"
                + (prep ? "&prep=me" : "");
    }

    private String mapString(Map<String, Object> row, String key) {
        if (row == null) return null;
        Object value = row.get(key);
        if (value == null) value = row.get(key.toLowerCase());
        return value == null ? null : String.valueOf(value);
    }
}
