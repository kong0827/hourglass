package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.PlanVersionRow;
import com.hourglass.dto.PublicReleasePlanView;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.ReleasePlanShare;
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
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 发布计划只读分享：令牌生命周期、管理权校验与公开视图的字段取舍。 */
class ReleasePlanShareServiceTest {

    private static final String WS = "W1";
    private static final String PLAN = "P1";
    private static final String USER = "U1";

    private final ReleasePlanShareMapper shareMapper = mock(ReleasePlanShareMapper.class);
    private final ReleaseMapper releaseMapper = mock(ReleaseMapper.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final ProjectVersionMapper versionMapper = mock(ProjectVersionMapper.class);
    private final RequirementMapper reqMapper = mock(RequirementMapper.class);
    private final VersionTaskMapper versionTaskMapper = mock(VersionTaskMapper.class);
    private final UserMapper userMapper = mock(UserMapper.class);
    private final WorkspaceMapper workspaceMapper = mock(WorkspaceMapper.class);
    private final ReleasePlanShareService service = new ReleasePlanShareService(shareMapper, releaseMapper,
            permissions, versionMapper, reqMapper, versionTaskMapper, userMapper, workspaceMapper);

    @Test
    void blankOrUnknownTokenIsNotFound() {
        assertThrows(AppException.class, () -> service.publicView(null));
        assertThrows(AppException.class, () -> service.publicView("  "));
        when(shareMapper.selectByToken("NOPE")).thenReturn(null);
        AppException ex = assertThrows(AppException.class, () -> service.publicView("NOPE"));
        assertEquals(404, ex.getCode());
    }

    @Test
    void revokedTokenIsNotFound() {
        ReleasePlanShare share = new ReleasePlanShare();
        share.setWorkspaceId(WS);
        share.setPlanId(PLAN);
        share.setRevokedAt(LocalDateTime.now());
        when(shareMapper.selectByToken("T1")).thenReturn(share);
        AppException ex = assertThrows(AppException.class, () -> service.publicView("T1"));
        assertEquals(404, ex.getCode());
    }

    @Test
    void deletedPlanIsNotFound() {
        ReleasePlanShare share = new ReleasePlanShare();
        share.setWorkspaceId(WS);
        share.setPlanId(PLAN);
        when(shareMapper.selectByToken("T1")).thenReturn(share);
        when(releaseMapper.selectPlan(WS, PLAN)).thenReturn(null);
        AppException ex = assertThrows(AppException.class, () -> service.publicView("T1"));
        assertEquals(404, ex.getCode());
    }

    @Test
    void publicViewShowsPlanScopeOnly() {
        ReleasePlanShare share = new ReleasePlanShare();
        share.setWorkspaceId(WS);
        share.setPlanId(PLAN);
        when(shareMapper.selectByToken("T1")).thenReturn(share);

        VersionReleasePlan plan = new VersionReleasePlan();
        plan.setId(PLAN);
        plan.setWorkspaceId(WS);
        plan.setPlanNo(7);
        plan.setStatus("ready");
        plan.setEnvironment("production");
        plan.setCoverage("full");
        plan.setPlannedAt(LocalDateTime.of(2026, 12, 2, 20, 0));
        plan.setOwnerUserId(USER);
        when(releaseMapper.selectPlan(WS, PLAN)).thenReturn(plan);

        PlanVersionRow row = new PlanVersionRow();
        row.setVersionId("V1");
        row.setVersionName("V1.2");
        row.setReqId("R1");
        row.setProjectName("资金通");
        row.setVersionStatus("active");
        row.setTargetDate(LocalDate.of(2026, 11, 27));
        row.setReleased(Boolean.FALSE);
        when(releaseMapper.selectPlanVersions(WS, PLAN)).thenReturn(Collections.singletonList(row));

        Workspace workspace = new Workspace();
        workspace.setName("运营研发中心");
        when(workspaceMapper.selectById(WS)).thenReturn(workspace);
        AppUser owner = new AppUser();
        owner.setDisplayName("admin");
        when(userMapper.selectById(USER)).thenReturn(owner);

        when(releaseMapper.selectPlannedTaskIds(WS, PLAN)).thenReturn(Arrays.asList("T1", "T2", "T3"));
        when(releaseMapper.selectScopeForVersions(WS, Collections.singletonList("V1")))
                .thenReturn(Arrays.asList(task("T1", 35, "已完成"), task("T2", 37, "进行中"), task("T4", 99, "进行中")));

        PublicReleasePlanView view = service.publicView("T1");

        assertEquals("运营研发中心", view.getWorkspaceName());
        assertEquals("资金通 · V1.2", view.getTitle());
        assertEquals(1, view.getVersionCount());
        assertEquals(0, view.getReleasedCount());
        assertEquals("admin", view.getOwnerName());
        assertEquals(3, view.getTaskCount(), "计划范围以勾选为准，包含当前不可见的项");
        assertEquals(2, view.getTasks().size(), "明细只展示仍在版本范围内的工作项");
        assertEquals(35, view.getTasks().get(0).getItemNo());
        assertEquals("资金通", view.getTasks().get(0).getProjectName());
        assertEquals("V1.2", view.getTasks().get(0).getVersionNames());
        verify(shareMapper, never()).revoke(anyString(), anyString());
    }

    @Test
    void createRequiresManagementOnEveryCoveredProject() {
        when(releaseMapper.selectPlan(WS, PLAN)).thenReturn(plan());
        when(releaseMapper.selectPlanVersions(WS, PLAN)).thenReturn(Arrays.asList(row("V1", "R1"), row("V2", "R2")));
        doThrow(new AppException(403, "没有权限")).when(permissions).assertManageRelease(USER, WS, "R2");

        AppException ex = assertThrows(AppException.class, () -> service.createShare(USER, WS, PLAN));
        assertEquals(403, ex.getCode());
        verify(shareMapper, never()).upsert(any(ReleasePlanShare.class));
    }

    @Test
    void createGeneratesOpaqueTokenAndReturnsSavedShare() {
        when(releaseMapper.selectPlan(WS, PLAN)).thenReturn(plan());
        when(releaseMapper.selectPlanVersions(WS, PLAN)).thenReturn(Collections.singletonList(row("V1", "R1")));
        ReleasePlanShare saved = new ReleasePlanShare();
        saved.setWorkspaceId(WS);
        saved.setPlanId(PLAN);
        saved.setToken("SAVED");
        when(shareMapper.selectByPlan(WS, PLAN)).thenReturn(saved);

        ReleasePlanShare result = service.createShare(USER, WS, PLAN);

        ArgumentCaptor<ReleasePlanShare> captor = ArgumentCaptor.forClass(ReleasePlanShare.class);
        verify(shareMapper).upsert(captor.capture());
        String token = captor.getValue().getToken();
        assertNotNull(token);
        assertTrue(token.matches("[0-9a-f]{32}"), "令牌为 32 位十六进制，不含计划信息");
        assertEquals(USER, captor.getValue().getCreatedBy());
        assertEquals("SAVED", result.getToken());
    }

    @Test
    void shareInfoHidesRevokedLink() {
        when(releaseMapper.selectPlan(WS, PLAN)).thenReturn(plan());
        when(releaseMapper.selectPlanVersions(WS, PLAN)).thenReturn(Collections.singletonList(row("V1", "R1")));
        ReleasePlanShare revoked = new ReleasePlanShare();
        revoked.setRevokedAt(LocalDateTime.now());
        when(shareMapper.selectByPlan(WS, PLAN)).thenReturn(revoked);

        assertNull(service.shareInfo(USER, WS, PLAN));
    }

    @Test
    void revokeRequiresManagement() {
        when(releaseMapper.selectPlan(WS, PLAN)).thenReturn(plan());
        when(releaseMapper.selectPlanVersions(WS, PLAN)).thenReturn(Collections.singletonList(row("V1", "R1")));
        doThrow(new AppException(403, "没有权限")).when(permissions).assertManageRelease(USER, WS, "R1");

        assertThrows(AppException.class, () -> service.revoke(USER, WS, PLAN));
        verify(shareMapper, never()).revoke(WS, PLAN);
    }

    private VersionReleasePlan plan() {
        VersionReleasePlan plan = new VersionReleasePlan();
        plan.setId(PLAN);
        plan.setWorkspaceId(WS);
        plan.setVersionId("V1");
        return plan;
    }

    private PlanVersionRow row(String versionId, String reqId) {
        PlanVersionRow row = new PlanVersionRow();
        row.setVersionId(versionId);
        row.setReqId(reqId);
        return row;
    }

    private Task task(String id, int itemNo, String column) {
        Task task = new Task();
        task.setId(id);
        task.setItemNo(itemNo);
        task.setTitle("工作项" + itemNo);
        task.setItemType("task");
        task.setBoardColumn(column);
        task.setOwner("张亮");
        task.setReqId("R1");
        task.setDueDate(LocalDate.of(2027, 3, 1));
        task.setVersionIds(Collections.singletonList("V1"));
        return task;
    }
}
