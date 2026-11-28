package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.PlanVersionRow;
import com.hourglass.dto.PublicReleasePlanView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.ReleasePlanShare;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.VersionReleasePlan;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.ReleasePlanShareMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 发布计划只读分享：管理端生成 / 查看 / 停止链接；公开页凭 token 读取计划范围。
 * 计划只是意图，公开页展示的也是「预计」，不推断实际发布结果。
 */
@Service
public class ReleasePlanShareService {

    private final ReleasePlanShareMapper shareMapper;
    private final ReleaseMapper releaseMapper;
    private final ReleasePermissionService permissions;
    private final ProjectVersionMapper versionMapper;
    private final RequirementMapper reqMapper;
    private final VersionTaskMapper versionTaskMapper;
    private final UserMapper userMapper;
    private final WorkspaceMapper workspaceMapper;

    public ReleasePlanShareService(ReleasePlanShareMapper shareMapper, ReleaseMapper releaseMapper,
                                   ReleasePermissionService permissions, ProjectVersionMapper versionMapper,
                                   RequirementMapper reqMapper, VersionTaskMapper versionTaskMapper,
                                   UserMapper userMapper, WorkspaceMapper workspaceMapper) {
        this.shareMapper = shareMapper;
        this.releaseMapper = releaseMapper;
        this.permissions = permissions;
        this.versionMapper = versionMapper;
        this.reqMapper = reqMapper;
        this.versionTaskMapper = versionTaskMapper;
        this.userMapper = userMapper;
        this.workspaceMapper = workspaceMapper;
    }

    /** 当前有效链接；已停止或未生成返回 null。 */
    public ReleasePlanShare shareInfo(String userId, String workspaceId, String planId) {
        requireManage(userId, workspaceId, planId);
        ReleasePlanShare share = shareMapper.selectByPlan(workspaceId, planId);
        return share != null && share.getRevokedAt() == null ? share : null;
    }

    /** 生成或换新链接：撤销后重新生成会得到新 token，旧链接不会复活。 */
    public ReleasePlanShare createShare(String userId, String workspaceId, String planId) {
        requireManage(userId, workspaceId, planId);
        ReleasePlanShare share = new ReleasePlanShare();
        share.setWorkspaceId(workspaceId);
        share.setPlanId(planId);
        share.setCreatedBy(userId);
        for (int attempt = 0; attempt < 3; attempt++) {
            share.setToken(newToken());
            try {
                shareMapper.upsert(share);
                return shareMapper.selectByPlan(workspaceId, planId);
            } catch (DuplicateKeyException e) {
                String message = e.getMessage();
                if (message == null || !message.contains("uk_rps_token")) throw e;
            }
        }
        throw AppException.badRequest("分享链接生成冲突，请重试");
    }

    public void revoke(String userId, String workspaceId, String planId) {
        requireManage(userId, workspaceId, planId);
        shareMapper.revoke(workspaceId, planId);
    }

    /** 公开只读：token 有效且未撤销才返回；不含备注、风险与内部检查。 */
    public PublicReleasePlanView publicView(String token) {
        String value = Texts.trimToNull(token);
        if (value == null) throw AppException.notFound("链接无效或已停止分享");
        ReleasePlanShare share = shareMapper.selectByToken(value);
        if (share == null || share.getRevokedAt() != null) throw AppException.notFound("链接无效或已停止分享");
        String workspaceId = share.getWorkspaceId();
        VersionReleasePlan plan = releaseMapper.selectPlan(workspaceId, share.getPlanId());
        if (plan == null) throw AppException.notFound("链接无效或已停止分享");

        List<PlanVersionRow> versionRows = planVersions(workspaceId, plan);
        PublicReleasePlanView view = new PublicReleasePlanView();
        view.setPlanNo(plan.getPlanNo());
        view.setStatus(plan.getStatus());
        view.setPlannedAt(plan.getPlannedAt());
        view.setEnvironment(plan.getEnvironment());
        view.setCoverage(plan.getCoverage());
        view.setPlanUpdatedAt(plan.getUpdatedAt());
        view.setGeneratedAt(LocalDateTime.now());

        Workspace workspace = workspaceMapper.selectById(workspaceId);
        view.setWorkspaceName(workspace == null ? null : workspace.getName());
        AppUser owner = Texts.trimToNull(plan.getOwnerUserId()) == null
                ? null : userMapper.selectById(plan.getOwnerUserId());
        view.setOwnerName(owner == null ? null : owner.getDisplayName());

        List<String> versionIds = new ArrayList<String>();
        Set<String> versionIdSet = new HashSet<String>();
        Map<String, String> projectNames = new HashMap<String, String>();
        Map<String, String> versionNames = new HashMap<String, String>();
        LinkedHashSet<String> titles = new LinkedHashSet<String>();
        int released = 0;
        for (PlanVersionRow row : versionRows) {
            versionIds.add(row.getVersionId());
            versionIdSet.add(row.getVersionId());
            projectNames.put(row.getReqId(), row.getProjectName());
            versionNames.put(row.getVersionId(), row.getVersionName());
            if (Texts.trimToNull(row.getProjectName()) != null && Texts.trimToNull(row.getVersionName()) != null) {
                titles.add(row.getProjectName() + " · " + row.getVersionName());
            }
            if (Boolean.TRUE.equals(row.getReleased())) released++;

            PublicReleasePlanView.VersionRow item = new PublicReleasePlanView.VersionRow();
            item.setVersionName(row.getVersionName());
            item.setProjectName(row.getProjectName());
            item.setStatus(row.getVersionStatus());
            item.setTargetDate(row.getTargetDate());
            item.setReleased(row.getReleased());
            view.getVersions().add(item);
        }
        view.setVersionCount(versionIds.size());
        view.setReleasedCount(released);
        view.setTitle(String.join(" / ", titles));

        List<String> plannedIds = releaseMapper.selectPlannedTaskIds(workspaceId, plan.getId());
        view.setTaskCount(plannedIds.size());
        view.setTasks(loadTasks(workspaceId, versionIds, versionIdSet, plannedIds, projectNames, versionNames));
        return view;
    }

    private List<PublicReleasePlanView.TaskRow> loadTasks(String workspaceId, List<String> versionIds,
                                                          Set<String> versionIdSet, List<String> plannedIds,
                                                          Map<String, String> projectNames,
                                                          Map<String, String> versionNames) {
        List<PublicReleasePlanView.TaskRow> rows = new ArrayList<PublicReleasePlanView.TaskRow>();
        if (plannedIds.isEmpty() || versionIds.isEmpty()) return rows;
        Set<String> planned = new HashSet<String>(plannedIds);
        List<Task> scope = releaseMapper.selectScopeForVersions(workspaceId, versionIds);
        List<Task> plannedTasks = new ArrayList<Task>();
        for (Task task : scope) {
            if (planned.contains(task.getId())) plannedTasks.add(task);
        }
        if (plannedTasks.isEmpty()) return rows;
        versionTaskMapper.enrichTasks(workspaceId, plannedTasks);
        for (Task task : plannedTasks) {
            PublicReleasePlanView.TaskRow row = new PublicReleasePlanView.TaskRow();
            row.setItemNo(task.getItemNo());
            row.setTitle(task.getTitle());
            row.setItemType(task.getItemType());
            row.setBoardColumn(task.getBoardColumn());
            row.setOwnerName(task.getOwner());
            row.setProjectName(projectNames.get(task.getReqId()));
            row.setDueDate(task.getDueDate());
            List<String> names = new ArrayList<String>();
            if (task.getVersionIds() != null) {
                for (String id : task.getVersionIds()) {
                    if (versionIdSet.contains(id) && versionNames.get(id) != null) names.add(versionNames.get(id));
                }
            }
            row.setVersionNames(String.join(" / ", names));
            rows.add(row);
        }
        rows.sort((a, b) -> {
            int byProject = String.valueOf(a.getProjectName()).compareTo(String.valueOf(b.getProjectName()));
            if (byProject != 0) return byProject;
            int an = a.getItemNo() == null ? Integer.MAX_VALUE : a.getItemNo();
            int bn = b.getItemNo() == null ? Integer.MAX_VALUE : b.getItemNo();
            if (an != bn) return an - bn;
            return String.valueOf(a.getTitle()).compareTo(String.valueOf(b.getTitle()));
        });
        return rows;
    }

    private VersionReleasePlan requirePlan(String workspaceId, String planId) {
        VersionReleasePlan plan = releaseMapper.selectPlan(workspaceId, planId);
        if (plan == null) throw AppException.notFound("发布计划不存在");
        return plan;
    }

    private void requireManage(String userId, String workspaceId, String planId) {
        VersionReleasePlan plan = requirePlan(workspaceId, planId);
        for (PlanVersionRow row : planVersions(workspaceId, plan)) {
            permissions.assertManageRelease(userId, workspaceId, row.getReqId());
        }
    }

    private List<PlanVersionRow> planVersions(String workspaceId, VersionReleasePlan plan) {
        List<PlanVersionRow> versions = releaseMapper.selectPlanVersions(workspaceId, plan.getId());
        if (!versions.isEmpty() || Texts.trimToNull(plan.getVersionId()) == null) return versions;
        ProjectVersion version = versionMapper.selectById(plan.getVersionId());
        if (version == null) return versions;
        PlanVersionRow row = new PlanVersionRow();
        row.setVersionId(version.getId());
        row.setVersionName(version.getName());
        row.setReqId(version.getReqId());
        Requirement project = reqMapper.selectById(version.getReqId());
        row.setProjectName(project == null ? null : project.getName());
        row.setVersionStatus(version.getStatus());
        row.setTargetDate(version.getTargetDate());
        row.setReleased(Boolean.FALSE);
        versions.add(row);
        return versions;
    }

    private static String newToken() {
        return UUID.randomUUID().toString().replace("-", "");
    }
}
