package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.ProjectSetSaveRequest;
import com.hourglass.dto.ReqTaskAggRow;
import com.hourglass.entity.ProjectSet;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectSetMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 项目集只做「归组 + 只读汇总」：
 * - 不参与权限判定，项目和成员的可见范围仍按项目自身配置；
 * - 删除项目集只解绑项目，绝不删除项目、工作项或需求；
 * - 增删改仅空间主/管理员可执行（D8：一期不单独授权给集成员）。
 */
@Service
public class ProjectSetService {

    private static final String DEFAULT_COLOR = "#8a8578";

    private final ProjectSetMapper setMapper;
    private final RequirementMapper reqMapper;
    private final TaskMapper taskMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final ProjectAccessService projectAccess;
    private final AuditService audit;

    public ProjectSetService(ProjectSetMapper setMapper, RequirementMapper reqMapper, TaskMapper taskMapper,
                             WorkspaceMemberMapper memberMapper, ProjectAccessService projectAccess,
                             AuditService audit) {
        this.setMapper = setMapper;
        this.reqMapper = reqMapper;
        this.taskMapper = taskMapper;
        this.memberMapper = memberMapper;
        this.projectAccess = projectAccess;
        this.audit = audit;
    }

    /** 项目集列表：附带当前查看者可见项目的只读汇总；无可见项目的集只对管理者返回。 */
    public List<ProjectSet> list(String workspaceId, String userId) {
        boolean manage = projectAccess.canManage(workspaceId, userId);
        Set<String> hidden = projectAccess.hiddenProjectIds(workspaceId, userId);
        List<Requirement> reqs = reqMapper.selectAll(workspaceId);
        Map<String, Integer> taskByReq = new HashMap<String, Integer>();
        Map<String, Integer> doneByReq = new HashMap<String, Integer>();
        Map<String, Integer> progressSumByReq = new HashMap<String, Integer>();
        for (ReqTaskAggRow agg : taskMapper.countByReq(workspaceId)) {
            if (agg.getReqId() == null) {
                continue;
            }
            taskByReq.put(agg.getReqId(), agg.getTotal());
            doneByReq.put(agg.getReqId(), agg.getDone());
            progressSumByReq.put(agg.getReqId(), agg.getProgressSum());
        }
        Map<String, String> ownerNames = ownerNames(workspaceId);

        Map<String, List<Requirement>> bySet = new HashMap<String, List<Requirement>>();
        for (Requirement r : reqs) {
            if (r.getSetId() == null || hidden.contains(r.getId())) {
                continue;
            }
            List<Requirement> bucket = bySet.get(r.getSetId());
            if (bucket == null) {
                bucket = new ArrayList<Requirement>();
                bySet.put(r.getSetId(), bucket);
            }
            bucket.add(r);
        }

        List<ProjectSet> out = new ArrayList<ProjectSet>();
        for (ProjectSet set : setMapper.selectAll(workspaceId)) {
            List<Requirement> rows = bySet.get(set.getId());
            int count = rows == null ? 0 : rows.size();
            if (!manage && count == 0) {
                continue; // 不向普通成员暴露没有可见项目的项目集名称
            }
            set.setOwnerName(ownerNames.get(set.getOwnerUserId()));
            set.setProjectCount(count);
            int tasks = 0, done = 0, progressSum = 0;
            if (rows != null) {
                for (Requirement r : rows) {
                    tasks += intOf(taskByReq.get(r.getId()));
                    done += intOf(doneByReq.get(r.getId()));
                    progressSum += intOf(progressSumByReq.get(r.getId()));
                }
            }
            set.setTaskCount(tasks);
            set.setDoneCount(done);
            set.setProgressPct(tasks == 0 ? 0 : (int) Math.round((double) progressSum / tasks));
            out.add(set);
        }
        return out;
    }

    @Transactional
    public ProjectSet create(String workspaceId, String userId, ProjectSetSaveRequest req) {
        requireManage(workspaceId, userId);
        ProjectSet set = new ProjectSet();
        set.setId(Ids.gen("PS"));
        set.setWorkspaceId(workspaceId);
        apply(workspaceId, set, req);
        if (setMapper.countByName(workspaceId, set.getName(), null) > 0) {
            throw new AppException(409, "项目集「" + set.getName() + "」已存在");
        }
        set.setSortOrder(setMapper.selectMaxSortOrder(workspaceId) + 1);
        setMapper.insert(set);
        audit.recordCurrent(workspaceId, "project_set_create", "project_set", set.getId(), set.getName(),
                true, "新建项目集「" + set.getName() + "」", null);
        return setMapper.selectById(workspaceId, set.getId());
    }

    @Transactional
    public ProjectSet update(String workspaceId, String userId, String id, ProjectSetSaveRequest req) {
        requireManage(workspaceId, userId);
        ProjectSet old = setMapper.selectById(workspaceId, id);
        if (old == null) {
            throw AppException.notFound("项目集不存在：" + id);
        }
        ProjectSet set = new ProjectSet();
        set.setId(id);
        set.setWorkspaceId(workspaceId);
        apply(workspaceId, set, req);
        if (setMapper.countByName(workspaceId, set.getName(), id) > 0) {
            throw new AppException(409, "项目集「" + set.getName() + "」已存在");
        }
        set.setUpdatedAt(req.getUpdatedAt());
        if (setMapper.update(set) == 0) {
            throw new AppException(409, "项目集已被其他人修改，请刷新后重试");
        }
        audit.recordCurrent(workspaceId, "project_set_update", "project_set", id, set.getName(),
                true, "更新项目集「" + old.getName() + "」", null);
        return setMapper.selectById(workspaceId, id);
    }

    /**
     * 项目集手动排序：ids 必须是空间内全部项目集的新顺序。
     * 期间有集被增删（数量或成员对不上）时回 409，让前端刷新后重试。
     */
    @Transactional
    public void reorder(String workspaceId, String userId, List<String> ids) {
        requireManage(workspaceId, userId);
        if (ids == null || ids.isEmpty()) {
            throw new AppException(400, "项目集顺序不能为空");
        }
        Set<String> existing = new HashSet<String>();
        for (ProjectSet set : setMapper.selectAll(workspaceId)) {
            existing.add(set.getId());
        }
        Set<String> seen = new HashSet<String>();
        for (String id : ids) {
            if (id == null || !existing.contains(id) || !seen.add(id)) {
                throw new AppException(409, "项目集顺序已变化，请刷新后重试");
            }
        }
        if (seen.size() != existing.size()) {
            throw new AppException(409, "项目集顺序已变化，请刷新后重试");
        }
        for (int i = 0; i < ids.size(); i++) {
            setMapper.updateSortOrder(workspaceId, ids.get(i), i);
        }
    }

    /** 删除只解散归组：项目回到「未分组」，项目、工作项、需求与权限一律不动。 */
    @Transactional
    public void delete(String workspaceId, String userId, String id) {
        requireManage(workspaceId, userId);
        ProjectSet old = setMapper.selectById(workspaceId, id);
        if (old == null) {
            throw AppException.notFound("项目集不存在：" + id);
        }
        int unbound = setMapper.unbindProjects(workspaceId, id);
        setMapper.deleteById(workspaceId, id);
        audit.recordCurrent(workspaceId, "project_set_delete", "project_set", id, old.getName(),
                true, "删除项目集「" + old.getName() + "」，" + unbound + " 个项目回到未分组", null);
    }

    /** 项目列表回填 set 名称用：只取 id→name，避免每个项目再查一次。 */
    public Map<String, String> nameMap(String workspaceId) {
        Map<String, String> names = new HashMap<String, String>();
        for (ProjectSet set : setMapper.selectAll(workspaceId)) {
            names.put(set.getId(), set.getName());
        }
        return names;
    }

    /** 项目保存时校验：项目集必须属于当前空间；空串表示解除归组。 */
    public String normalizeSetId(String workspaceId, String rawSetId) {
        String setId = Texts.trimToNull(rawSetId);
        if (setId == null) {
            return null;
        }
        if (setMapper.selectById(workspaceId, setId) == null) {
            throw new AppException(400, "项目集不存在或不属于当前空间");
        }
        return setId;
    }

    private void requireManage(String workspaceId, String userId) {
        if (!projectAccess.canManage(workspaceId, userId)) {
            throw new AppException(403, "仅空间主或管理员可维护项目集");
        }
    }

    private void apply(String workspaceId, ProjectSet set, ProjectSetSaveRequest req) {
        String name = Texts.trimToNull(req.getName());
        if (name == null) {
            throw new AppException(400, "请填写项目集名称");
        }
        set.setName(name);
        set.setDescription(Texts.trimToNull(req.getDescription()));
        String ownerId = Texts.trimToNull(req.getOwnerUserId());
        if (ownerId != null && memberMapper.selectMember(workspaceId, ownerId) == null) {
            throw new AppException(400, "项目集负责人不是当前空间成员");
        }
        set.setOwnerUserId(ownerId);
        set.setStatus(req.getStatus() == null ? "active" : req.getStatus());
        if (req.getPlannedStart() != null && req.getPlannedEnd() != null
                && req.getPlannedEnd().isBefore(req.getPlannedStart())) {
            throw new AppException(400, "计划结束日不能早于计划开始日");
        }
        set.setPlannedStart(req.getPlannedStart());
        set.setPlannedEnd(req.getPlannedEnd());
        String color = Texts.trimToNull(req.getColor());
        set.setColor(color == null ? DEFAULT_COLOR : color);
    }

    private Map<String, String> ownerNames(String workspaceId) {
        Map<String, String> names = new HashMap<String, String>();
        for (WorkspaceMember m : memberMapper.selectByWorkspace(workspaceId)) {
            if (m.getUserId() != null && m.getDisplayName() != null) {
                names.put(m.getUserId(), m.getDisplayName());
            }
        }
        return names;
    }

    private static int intOf(Integer value) {
        return value == null ? 0 : value;
    }
}
