package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.BranchSaveRequest;
import com.devstudio.kanban.dto.BranchStatusRequest;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.entity.DevBranch;
import com.devstudio.kanban.entity.DevBranchLog;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
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

    public BranchService(DevBranchMapper branchMapper, TaskMapper taskMapper, UserMapper userMapper) {
        this.branchMapper = branchMapper;
        this.taskMapper = taskMapper;
        this.userMapper = userMapper;
    }

    public static String label(String status) {
        String s = LABELS.get(status);
        return s == null ? status : s;
    }

    public List<DevBranch> list(String workspaceId) {
        return branchMapper.selectByWorkspace(workspaceId);
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
        if (branchMapper.countByName(workspaceId, name, null) > 0) {
            throw AppException.badRequest("分支「" + name + "」已存在");
        }
        String status = normalizeStatus(req.getStatus(), ST_DEV);

        DevBranch b = new DevBranch();
        b.setId(Ids.gen("B"));
        b.setWorkspaceId(workspaceId);
        b.setName(name);
        b.setStatus(status);
        applyOwner(b, userId, req.getOwner(), req.getOwnerUserId());
        b.setTargetBranch(normalizeTarget(req.getTargetBranch()));
        b.setNote(Texts.cut(Texts.trimToNull(req.getNote()), 200));
        stampInitial(b, status);

        branchMapper.insert(b);
        log(userId, workspaceId, b.getId(), "create", null, status,
                "创建分支（初始状态：" + label(status) + "）");
        return branchMapper.selectById(b.getId());
    }

    /**
     * 编辑基础信息。改名要重新查重；状态不在这里改（status 字段被忽略，统一走 changeStatus），
     * 否则「改名字顺手把状态也改了」会绕过时间线与时间点。
     */
    @Transactional
    public DevBranch update(String userId, String workspaceId, String id, BranchSaveRequest req) {
        DevBranch b = get(workspaceId, id);
        String name = req.getName() == null ? b.getName() : normalizeName(req.getName());
        if (!name.equals(b.getName()) && branchMapper.countByName(workspaceId, name, id) > 0) {
            throw AppException.badRequest("分支「" + name + "」已存在");
        }

        List<String> changed = new ArrayList<String>();
        if (!name.equals(b.getName())) {
            changed.add("分支名 " + b.getName() + " → " + name);
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
        if (ownerGiven) {
            applyOwner(b, userId, req.getOwner(), req.getOwnerUserId());
            if (!eq(oldOwner, b.getOwner())) {
                changed.add("负责人 " + nz(oldOwner) + " → " + nz(b.getOwner()));
            }
        }

        b.setName(name);
        b.setTargetBranch(target);
        b.setNote(note);
        branchMapper.update(b);
        if (!changed.isEmpty()) {
            log(userId, workspaceId, id, "update", b.getStatus(), b.getStatus(), join(changed));
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
        return branchMapper.selectById(id);
    }

    /** 删除分支：先把挂在它上面的任务解绑（任务保留），再删时间线与分支本身。 */
    @Transactional
    public void delete(String workspaceId, String id) {
        get(workspaceId, id);
        taskMapper.clearBranchRef(workspaceId, id);
        branchMapper.deleteLogsByBranch(id);
        branchMapper.deleteById(id);
    }

    public List<DevBranchLog> logs(String workspaceId, String id) {
        get(workspaceId, id);
        return branchMapper.selectLogs(id);
    }

    /** 分支详情里的「关联任务」：未完成的排前面，同优先级按创建顺序 */
    public List<Task> tasks(String workspaceId, String id) {
        get(workspaceId, id);
        return taskMapper.selectByBranch(workspaceId, id);
    }

    /* ==================== 内部 ==================== */

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
