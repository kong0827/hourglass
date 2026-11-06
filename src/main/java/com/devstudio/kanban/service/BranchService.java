package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.BranchProjectTag;
import com.devstudio.kanban.dto.BranchSaveRequest;
import com.devstudio.kanban.dto.BranchStatusRequest;
import com.devstudio.kanban.dto.BranchVersionTag;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.DevBranch;
import com.devstudio.kanban.entity.DevBranchLog;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 分支管理（空间级分支池）。
 *
 * <p><b>状态口径</b>：dev(开发中) → testing(待测试) → merging(待合并) → released(已发布)。
 * 允许任意方向的切换——现实里「待测试被打回开发中」很常见，强行单向会逼人去删分支重建。
 *
 * <p><b>时间口径</b>（两套，各管一件事）：
 * <ul>
 *   <li>分支表上的 devAt / testAt / mergeAt / releasedAt 只记**首次进入**该状态的时间，
 *       用 COALESCE 写入不会被后续回退冲掉 → 用来算「发布周期」「卡在待测试多久」；</li>
 *   <li>dev_branch_log 记**每一次**变更（谁、从哪到哪、什么时候、附带说明）→ 用来在详情页
 *       还原完整时间线，包括被打回的那几次。</li>
 * </ul>
 */
@Service
public class BranchService {

    public static final String ST_DEV = "dev";
    public static final String ST_TESTING = "testing";
    public static final String ST_MERGING = "merging";
    public static final String ST_RELEASED = "released";

    /** 状态中文名（日志文案用） */
    private static final Map<String, String> LABELS = new LinkedHashMap<String, String>();

    static {
        LABELS.put(ST_DEV, "开发中");
        LABELS.put(ST_TESTING, "待测试");
        LABELS.put(ST_MERGING, "待合并");
        LABELS.put(ST_RELEASED, "已发布");
    }

    private final DevBranchMapper branchMapper;
    private final TaskMapper taskMapper;
    private final UserMapper userMapper;
    private final ProjectAccessService projectAccess;
    private final RequirementMapper requirementMapper;
    private final NotificationEventService notificationEvents;

    public BranchService(DevBranchMapper branchMapper, TaskMapper taskMapper, UserMapper userMapper,
                         ProjectAccessService projectAccess, RequirementMapper requirementMapper,
                         NotificationEventService notificationEvents) {
        this.branchMapper = branchMapper;
        this.taskMapper = taskMapper;
        this.userMapper = userMapper;
        this.projectAccess = projectAccess;
        this.requirementMapper = requirementMapper;
        this.notificationEvents = notificationEvents;
    }

    public static String label(String status) {
        String s = LABELS.get(status);
        return s == null ? status : s;
    }

    public List<DevBranch> list(String workspaceId, String userId) {
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        List<DevBranch> branches = branchMapper.selectVisibleByWorkspace(workspaceId, viewerId, null);
        excludeHiddenProjectBranches(workspaceId, userId, branches);
        fillVersions(workspaceId, viewerId, branches);
        fillProjects(workspaceId, viewerId, branches);
        return branches;
    }

    /** 直接归属隐藏项目的分支不返回；空间级公共分支不受影响 */
    private void excludeHiddenProjectBranches(String workspaceId, String userId, List<DevBranch> branches) {
        java.util.Set<String> hidden = projectAccess.hiddenProjectIds(workspaceId, userId);
        if (hidden.isEmpty()) {
            return;
        }
        java.util.Iterator<DevBranch> it = branches.iterator();
        while (it.hasNext()) {
            DevBranch b = it.next();
            if (b.getReqId() != null && hidden.contains(b.getReqId())) {
                it.remove();
            }
        }
    }

    /**
     * 按项目筛选的分支列表。
     *
     * <p>优先返回直接归属该项目的分支（reqId = projectId），同时保留空间级公共分支（reqId 为空）
     * 以及通过任务推导归属该项目的分支，保证老数据不消失；尚未关联任何任务的公共分支
     * 对所有项目可见，否则新建后无法挂到任务上。</p>
     */
    public List<DevBranch> list(String workspaceId, String userId, String projectId) {
        if (projectId == null || projectId.isEmpty()) {
            return list(workspaceId, userId);
        }
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        List<DevBranch> branches = branchMapper.selectVisibleByWorkspace(workspaceId, viewerId, projectId);
        excludeHiddenProjectBranches(workspaceId, userId, branches);
        fillVersions(workspaceId, viewerId, branches);
        fillProjects(workspaceId, viewerId, branches);
        List<DevBranch> filtered = new ArrayList<DevBranch>();
        for (DevBranch b : branches) {
            if (projectId.equals(b.getReqId())) {
                filtered.add(b);
                continue;
            }
            List<BranchProjectTag> tags = b.getProjects();
            if (tags == null || tags.isEmpty()) {
                /* 尚未关联任何任务的公共分支：任何项目都能选 */
                filtered.add(b);
                continue;
            }
            for (BranchProjectTag tag : tags) {
                if (projectId.equals(tag.getProjectId())) {
                    filtered.add(b);
                    break;
                }
            }
        }
        return filtered;
    }

    /** 分支详情（列表 + 抽屉共用实体）：带推导的影响版本标签与归属项目标签 */
    public DevBranch getDetail(String workspaceId, String userId, String id) {
        DevBranch b = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, b.getReqId());
        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        fillVersions(workspaceId, viewerId, java.util.Collections.singletonList(b));
        fillProjects(workspaceId, viewerId, java.util.Collections.singletonList(b));
        return b;
    }

    /**
     * 影响版本标签：分支本身不绑版本，由「该分支下任务所归的版本」推导。
     * 一条分支的任务可能分散在多个版本（含跨项目），全部并列展示、不强行归一；
     * 排序按版本生命周期 planned → active → released。
     */
    private void fillVersions(String workspaceId, String viewerId, List<DevBranch> branches) {
        if (branches.isEmpty()) {
            return;
        }
        Map<String, List<BranchVersionTag>> byBranch = new LinkedHashMap<String, List<BranchVersionTag>>();
        for (BranchVersionTag tag : branchMapper.selectVersionTags(workspaceId, viewerId)) {
            List<BranchVersionTag> list = byBranch.get(tag.getBranchId());
            if (list == null) {
                list = new ArrayList<BranchVersionTag>();
                byBranch.put(tag.getBranchId(), list);
            }
            list.add(tag);
        }
        for (DevBranch b : branches) {
            List<BranchVersionTag> tags = byBranch.get(b.getId());
            if (tags == null) {
                continue;
            }
            Collections.sort(tags, (a, c) -> {
                int d = versionRank(a.getStatus()) - versionRank(c.getStatus());
                return d != 0 ? d : String.valueOf(a.getName()).compareTo(String.valueOf(c.getName()));
            });
            b.setVersions(tags);
        }
    }

    private static int versionRank(String status) {
        if ("planned".equals(status)) {
            return 0;
        }
        if ("active".equals(status)) {
            return 1;
        }
        return 2;
    }

    /**
     * 归属项目标签：分支本身不绑项目，由「该分支下任务所在的项目」推导。
     * 只返回查看人可见的项目，避免隐藏项目的项目名外泄。
     */
    private void fillProjects(String workspaceId, String viewerId, List<DevBranch> branches) {
        if (branches.isEmpty()) {
            return;
        }
        Map<String, List<BranchProjectTag>> byBranch = new LinkedHashMap<String, List<BranchProjectTag>>();
        for (BranchProjectTag tag : branchMapper.selectProjectTags(workspaceId, viewerId)) {
            List<BranchProjectTag> list = byBranch.get(tag.getBranchId());
            if (list == null) {
                list = new ArrayList<BranchProjectTag>();
                byBranch.put(tag.getBranchId(), list);
            }
            list.add(tag);
        }
        for (DevBranch b : branches) {
            List<BranchProjectTag> tags = byBranch.get(b.getId());
            if (tags != null && !tags.isEmpty()) {
                b.setProjects(tags);
            }
        }
    }

    public DevBranch get(String workspaceId, String id) {
        DevBranch b = branchMapper.selectById(id);
        if (b == null || !workspaceId.equals(b.getWorkspaceId())) {
            throw AppException.notFound("分支不存在：" + id);
        }
        return b;
    }

    @Transactional
    public DevBranch create(String userId, String workspaceId, BranchSaveRequest req) {
        String name = normalizeName(req.getName());
        String reqId = normalizeReqId(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, reqId);
        if (branchMapper.countByName(workspaceId, name, reqId, null) > 0) {
            throw AppException.badRequest("分支「" + name + "」已存在");
        }
        String status = normalizeStatus(req.getStatus(), ST_DEV);

        DevBranch b = new DevBranch();
        b.setId(Ids.gen("B"));
        b.setWorkspaceId(workspaceId);
        b.setReqId(reqId);
        b.setName(name);
        b.setStatus(status);
        applyOwner(b, userId, req.getOwner(), req.getOwnerUserId());
        b.setTargetBranch(normalizeTarget(req.getTargetBranch()));
        b.setNote(Texts.cut(Texts.trimToNull(req.getNote()), 200));
        stampInitial(b, status);

        try {
            branchMapper.insert(b);
        } catch (org.springframework.dao.DuplicateKeyException e) {
            throw AppException.badRequest("分支「" + name + "」已存在");
        }
        log(userId, workspaceId, b.getId(), "create", null, status,
                "创建分支（初始状态：" + label(status) + "）");
        notifyOwner(b, userId, "分支「" + b.getName() + "」已指派给你",
                "你成为该分支的负责人", b.getId());
        return branchMapper.selectById(b.getId());
    }

    /**
     * 编辑基础信息。改名要重新查重；状态不在这里改（status 字段被忽略，统一走 changeStatus），
     * 否则「改名字顺手把状态也改了」会绕过时间线与时间点。
     */
    @Transactional
    public DevBranch update(String userId, String workspaceId, String id, BranchSaveRequest req) {
        DevBranch b = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, b.getReqId());
        projectAccess.assertWrite(workspaceId, userId, b.getReqId());
        String name = req.getName() == null ? b.getName() : normalizeName(req.getName());
        String reqId = req.getReqId() == null ? b.getReqId() : normalizeReqId(workspaceId, req.getReqId());
        projectAccess.assertWrite(workspaceId, userId, reqId);
        if ((!name.equals(b.getName()) || !eq(reqId, b.getReqId()))
                && branchMapper.countByName(workspaceId, name, reqId, id) > 0) {
            throw AppException.badRequest("分支「" + name + "」已存在");
        }

        List<String> changed = new ArrayList<String>();
        if (!name.equals(b.getName())) {
            changed.add("分支名 " + b.getName() + " → " + name);
        }
        if (!eq(reqId, b.getReqId())) {
            changed.add("所属项目 " + nz(reqIdLabel(b.getReqId())) + " → " + nz(reqIdLabel(reqId)));
        }
        String target = req.getTargetBranch() == null
                ? b.getTargetBranch() : normalizeTarget(req.getTargetBranch());
        if (!eq(target, b.getTargetBranch())) {
            changed.add("目标分支 " + nz(b.getTargetBranch()) + " → " + nz(target));
        }
        String note = req.getNote() == null ? b.getNote() : Texts.cut(Texts.trimToNull(req.getNote()), 200);
        if (!eq(note, b.getNote())) {
            changed.add("备注已更新");
        }
        /* 负责人：只在请求里显式带了 owner / ownerUserId 时才动，
           否则「只改备注」会被当成"清空负责人"处理 */
        boolean ownerGiven = req.getOwner() != null || req.getOwnerUserId() != null;
        String oldOwner = b.getOwner();
        String oldOwnerUserId = b.getOwnerUserId();
        if (ownerGiven) {
            applyOwner(b, userId, req.getOwner(), req.getOwnerUserId());
            if (!eq(oldOwner, b.getOwner())) {
                changed.add("负责人 " + nz(oldOwner) + " → " + nz(b.getOwner()));
            }
        }

        b.setName(name);
        b.setReqId(reqId);
        b.setTargetBranch(target);
        b.setNote(note);
        try {
            branchMapper.update(b);
        } catch (org.springframework.dao.DuplicateKeyException e) {
            throw AppException.badRequest("分支「" + name + "」已存在");
        }
        if (!changed.isEmpty()) {
            log(userId, workspaceId, id, "update", b.getStatus(), b.getStatus(), join(changed));
        }
        if (ownerGiven && !eq(oldOwnerUserId, b.getOwnerUserId())) {
            notifyOwner(b, userId, "分支「" + b.getName() + "」已指派给你",
                    "你成为该分支的负责人", b.getId());
        }
        return branchMapper.selectById(id);
    }

    /**
     * 改状态：写状态 + 盖首次进入该状态的时间点 + 追加一条时间线。
     * 状态没变时直接返回（不写日志，避免点错一次就多一条噪音）。
     */
    @Transactional
    public DevBranch changeStatus(String userId, String workspaceId, String id, BranchStatusRequest req) {
        DevBranch b = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, b.getReqId());
        projectAccess.assertWrite(workspaceId, userId, b.getReqId());
        String from = b.getStatus();
        String to = normalizeStatus(req.getStatus(), null);
        if (to == null) {
            throw AppException.badRequest("分支状态不合法");
        }
        if (to.equals(from)) {
            return b;
        }
        branchMapper.updateStatus(workspaceId, id, to,
                ST_DEV.equals(to), ST_TESTING.equals(to), ST_MERGING.equals(to), ST_RELEASED.equals(to));
        String note = Texts.cut(Texts.trimToNull(req.getNote()), 80);
        log(userId, workspaceId, id, "status", from, to,
                note == null
                        ? (label(from) + " → " + label(to))
                        : (label(from) + " → " + label(to) + "：" + note));
        notifyOwner(b, userId, "分支「" + b.getName() + "」状态变更",
                label(from) + " → " + label(to) + (note == null ? "" : "：" + note), b.getId());
        return branchMapper.selectById(id);
    }

    /** 删除分支：先把挂在它上面的任务解绑（任务保留），再删时间线与分支本身。 */
    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        DevBranch b = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, b.getReqId());
        projectAccess.assertWrite(workspaceId, userId, b.getReqId());
        notifyOwner(b, userId, "分支「" + b.getName() + "」已被删除",
                "分支及其时间线已被删除，关联任务已解绑", null);
        taskMapper.clearBranchRef(workspaceId, id);
        branchMapper.deleteLogsByBranch(id);
        branchMapper.deleteById(workspaceId, id);
    }

    public List<DevBranchLog> logs(String workspaceId, String userId, String id) {
        DevBranch b = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, b.getReqId());
        return branchMapper.selectLogs(id);
    }

    /** 分支详情里的「关联任务」：未完成的排前面，同优先级按创建顺序；隐藏项目下的任务不返回 */
    public List<Task> tasks(String workspaceId, String userId, String id) {
        DevBranch b = get(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, b.getReqId());
        List<Task> list = taskMapper.selectByBranch(workspaceId, id);
        java.util.Set<String> hidden = projectAccess.hiddenProjectIds(workspaceId, userId);
        if (hidden.isEmpty()) {
            return list;
        }
        List<Task> visible = new ArrayList<Task>();
        for (Task t : list) {
            if (t.getReqId() == null || !hidden.contains(t.getReqId())) {
                visible.add(t);
            }
        }
        return visible;
    }

    /* ==================== 内部 ==================== */

    /** 分支负责人不是操作者时才通知 */
    private void notifyOwner(DevBranch b, String actorId, String title, String body, String referenceId) {
        String owner = Texts.trimToNull(b.getOwnerUserId());
        if (owner == null || owner.equals(actorId)) {
            return;
        }
        notificationEvents.notify(owner, b.getWorkspaceId(),
                UserNotificationPreferenceService.DEMAND_STATUS, title, body, referenceId, b.getReqId());
    }

    /** 新建时按初始状态盖上第一个时间点（其余留空，等真正进入再写） */
    private void stampInitial(DevBranch b, String status) {
        LocalDateTime now = LocalDateTime.now();
        if (ST_DEV.equals(status)) {
            b.setDevAt(now);
        } else if (ST_TESTING.equals(status)) {
            b.setTestAt(now);
        } else if (ST_MERGING.equals(status)) {
            b.setMergeAt(now);
        } else if (ST_RELEASED.equals(status)) {
            b.setReleasedAt(now);
        }
    }

    private void applyOwner(DevBranch b, String userId, String owner, String ownerUserId) {
        String ou = Texts.trimToNull(ownerUserId);
        if (ou != null) {
            AppUser u = userMapper.selectById(ou);
            if (u == null) {
                throw AppException.badRequest("负责人账号不存在：" + ou);
            }
            b.setOwnerUserId(ou);
            b.setOwner(Texts.cut(Texts.trimToNull(owner) == null ? u.getDisplayName() : owner.trim(), 32));
            return;
        }
        String name = Texts.trimToNull(owner);
        if (name == null) {
            /* 不填负责人 = 默认当前用户 */
            AppUser me = userMapper.selectById(userId);
            b.setOwner(me == null ? null : Texts.cut(me.getDisplayName(), 32));
            b.setOwnerUserId(userId);
        } else {
            b.setOwner(Texts.cut(name, 32));
            b.setOwnerUserId(null);
        }
    }

    private void log(String userId, String workspaceId, String branchId, String action,
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
        branchMapper.insertLog(l);
    }

    private String normalizeName(String raw) {
        String name = Texts.trimToNull(raw);
        if (name == null) {
            throw AppException.badRequest("请填写分支名");
        }
        if (name.length() > 80) {
            throw AppException.badRequest("分支名不能超过 80 字");
        }
        return name;
    }

    private String normalizeStatus(String raw, String fallback) {
        String s = Texts.trimToNull(raw);
        if (s == null) {
            return fallback;
        }
        if (!LABELS.containsKey(s)) {
            throw AppException.badRequest("分支状态不合法：" + s);
        }
        return s;
    }

    private String normalizeTarget(String raw) {
        String t = Texts.trimToNull(raw);
        if (t == null) {
            return null;
        }
        if (t.length() > 80) {
            throw AppException.badRequest("目标分支不能超过 80 字");
        }
        return t;
    }

    /** 空串统一按 null（空间级公共分支）处理；非空时必须是本空间的项目 */
    private String normalizeReqId(String workspaceId, String raw) {
        String reqId = Texts.trimToNull(raw);
        if (reqId == null) {
            return null;
        }
        Requirement r = requirementMapper.selectById(reqId);
        if (r == null || !workspaceId.equals(r.getWorkspaceId())) {
            throw AppException.badRequest("所属项目不存在：" + reqId);
        }
        return reqId;
    }

    private String reqIdLabel(String reqId) {
        return reqId == null ? "空间级公共" : reqId;
    }

    private static boolean eq(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    private static String nz(String v) {
        return v == null || v.isEmpty() ? "（空）" : v;
    }

    private static String join(List<String> parts) {
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (sb.length() > 0) {
                sb.append("；");
            }
            sb.append(p);
        }
        return sb.toString();
    }
}
