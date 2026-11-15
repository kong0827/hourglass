package com.hourglass.service;

import com.hourglass.dto.BranchProjectTag;
import com.hourglass.dto.BranchQuery;
import com.hourglass.dto.BranchStatusRequest;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.BranchVersionTag;
import com.hourglass.entity.DevBranch;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class BranchServiceTest {

    private static final String WS = "W1";

    private final DevBranchMapper branchMapper = mock(DevBranchMapper.class);
    private final com.hourglass.mapper.ProjectRepoMapper repoMapper =
            mock(com.hourglass.mapper.ProjectRepoMapper.class);
    private final TaskMapper taskMapper = mock(TaskMapper.class);
    private final UserMapper userMapper = mock(UserMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final RequirementMapper requirementMapper = mock(RequirementMapper.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final DeletionTraceService deletionTrace = mock(DeletionTraceService.class);
    private final BranchService service = new BranchService(branchMapper, repoMapper, taskMapper, userMapper, access,
            requirementMapper, events, deletionTrace);

    @Test
    void listFillsDerivedVersionTagsSortedByVersionLifecycle() {
        when(access.viewerScope(WS, "U1")).thenReturn("U1");
        when(branchMapper.selectVisibleByWorkspace(WS, "U1", null)).thenReturn(Arrays.asList(
                branch("B1"), branch("B2")));
        when(branchMapper.selectVersionTags(eq(WS), eq("U1"), anyList())).thenReturn(Arrays.asList(
                tag("B1", "V2", "v2.0", "released", "R1", "项目A"),
                tag("B1", "V1", "v1.0", "active", "R1", "项目A"),
                tag("B2", "V3", "v1.0", "planned", "R2", "项目B")));
        when(branchMapper.selectProjectTags(eq(WS), eq("U1"), anyList())).thenReturn(Arrays.asList(
                proj("B1", "R1", "项目A"),
                proj("B2", "R2", "项目B")));

        List<DevBranch> out = service.list(WS, "U1");

        assertEquals(2, out.get(0).getVersions().size(), "一条分支可同时挂多个版本，全部并列");
        assertEquals("v1.0", out.get(0).getVersions().get(0).getName(), "active 排在 released 前");
        assertEquals("v2.0", out.get(0).getVersions().get(1).getName());
        assertEquals(1, out.get(1).getVersions().size());
        assertEquals("v1.0", out.get(1).getVersions().get(0).getName());
        assertEquals("项目B", out.get(1).getVersions().get(0).getReqName(), "跨项目的版本靠 reqName 区分");
    }

    @Test
    void getDetailFillsVersionTagsAndKeepsEmptyWhenNone() {
        DevBranch b1 = branch("B1");
        DevBranch b2 = branch("B2");
        when(access.viewerScope(WS, "U9")).thenReturn(null);
        when(branchMapper.selectById("B1")).thenReturn(b1);
        when(branchMapper.selectById("B2")).thenReturn(b2);
        when(branchMapper.selectVersionTags(eq(WS), nullable(String.class), anyList())).thenReturn(Collections.singletonList(
                tag("B2", "V3", "v1.0", "planned", "R2", "项目B")));
        when(branchMapper.selectProjectTags(eq(WS), nullable(String.class), anyList())).thenReturn(Collections.singletonList(
                proj("B2", "R2", "项目B")));

        assertEquals(1, service.getDetail(WS, "U9", "B2").getVersions().size());
        assertNull(service.getDetail(WS, "U9", "B1").getVersions(), "无版本任务的分支不填该字段");
    }

    @Test
    void getDetailFillsViewerScopedTaskCounts() {
        DevBranch b1 = branch("B1");
        DevBranch stats = new DevBranch();
        stats.setTaskCount(5);
        stats.setDoneCount(2);
        when(access.viewerScope(WS, "U1")).thenReturn("U1");
        when(branchMapper.selectById("B1")).thenReturn(b1);
        when(branchMapper.selectTaskStats(WS, "U1", "B1")).thenReturn(stats);

        DevBranch out = service.getDetail(WS, "U1", "B1");
        assertEquals(Integer.valueOf(5), out.getTaskCount(), "抽屉与删除确认依赖详情里的计数");
        assertEquals(Integer.valueOf(2), out.getDoneCount());
    }

    @Test
    void listByProjectFiltersBranchesByDerivedProjectTag() {
        when(access.viewerScope(WS, "U1")).thenReturn("U1");
        when(branchMapper.selectVisibleByWorkspace(WS, "U1", "R1")).thenReturn(Arrays.asList(
                branch("B1"), branch("B2"), branch("B3")));
        when(branchMapper.selectVersionTags(eq(WS), eq("U1"), anyList())).thenReturn(Collections.emptyList());
        when(branchMapper.selectProjectTags(eq(WS), eq("U1"), anyList())).thenReturn(Arrays.asList(
                proj("B1", "R1", "项目A"),
                proj("B2", "R2", "项目B")));

        List<DevBranch> out = service.list(WS, "U1", "R1");

        /* B1 推导归属 R1；B2 只归属 R2 被过滤；B3 尚未关联任何项目，任何项目都可选 */
        assertEquals(2, out.size());
        assertEquals("B1", out.get(0).getId());
        assertEquals("B3", out.get(1).getId());
    }

    @Test
    void listByProjectKeepsDirectlyAssignedBranchEvenWithoutDerivedTag() {
        when(access.viewerScope(WS, "U1")).thenReturn("U1");
        DevBranch direct = branch("B1");
        direct.setReqId("R1");
        when(branchMapper.selectVisibleByWorkspace(WS, "U1", "R1")).thenReturn(Arrays.asList(
                direct, branch("B2")));
        when(branchMapper.selectVersionTags(eq(WS), eq("U1"), anyList())).thenReturn(Collections.emptyList());
        when(branchMapper.selectProjectTags(eq(WS), eq("U1"), anyList())).thenReturn(Collections.singletonList(
                proj("B2", "R2", "项目B")));

        List<DevBranch> out = service.list(WS, "U1", "R1");

        assertEquals(1, out.size(), "直接归属优先，不依赖任务推导标签");
        assertEquals("B1", out.get(0).getId());
    }

    @Test
    void listHidesBranchesDirectlyAssignedToHiddenProject() {
        when(access.viewerScope(WS, "U1")).thenReturn("U1");
        DevBranch hidden = branch("B1");
        hidden.setReqId("R2");
        DevBranch visible = branch("B2");
        visible.setReqId("R1");
        when(branchMapper.selectVisibleByWorkspace(WS, "U1", null)).thenReturn(
                new java.util.ArrayList<DevBranch>(Arrays.asList(hidden, visible)));
        when(access.hiddenProjectIds(WS, "U1")).thenReturn(Collections.singleton("R2"));
        when(branchMapper.selectVersionTags(eq(WS), eq("U1"), anyList())).thenReturn(Collections.emptyList());
        when(branchMapper.selectProjectTags(eq(WS), eq("U1"), anyList())).thenReturn(Collections.emptyList());

        List<DevBranch> out = service.list(WS, "U1");

        assertEquals(1, out.size());
        assertEquals("B2", out.get(0).getId());
    }

    @Test
    void statusChangeNotifiesOwner() {
        DevBranch b = branch("B1");
        b.setReqId("R1");
        b.setOwnerUserId("U2");
        when(branchMapper.selectById("B1")).thenReturn(b);
        BranchStatusRequest req = new BranchStatusRequest();
        req.setStatus(BranchService.ST_TESTING);

        service.changeStatus("U1", WS, "B1", req);

        verify(events).notifyLinked("U2", WS, UserNotificationPreferenceService.DEMAND_STATUS,
                "分支「B1」状态变更", "开发中 → 待测试", "branch", "B1", "R1");
    }

    @Test
    void statusChangeByOwnerDoesNotNotifySelf() {
        DevBranch b = branch("B1");
        b.setReqId("R1");
        b.setOwnerUserId("U2");
        when(branchMapper.selectById("B1")).thenReturn(b);
        BranchStatusRequest req = new BranchStatusRequest();
        req.setStatus(BranchService.ST_TESTING);

        service.changeStatus("U2", WS, "B1", req);

        verifyNoInteractions(events);
    }

    @Test
    void deleteNotifiesOwner() {
        DevBranch b = branch("B1");
        b.setReqId("R1");
        b.setOwnerUserId("U2");
        when(branchMapper.selectById("B1")).thenReturn(b);
        when(taskMapper.selectIdsByBranchForCascade(WS, "B1")).thenReturn(Arrays.asList("K1", "K2"));

        service.delete("U1", WS, "B1");

        verify(access).assertView(WS, "U1", "R1");
        verify(access).assertWrite(WS, "U1", "R1");
        verify(events).notifyLinked("U2", WS, UserNotificationPreferenceService.DEMAND_STATUS,
                "分支「B1」已被删除", "分支及其时间线已被删除，关联任务已解绑", "branch", "B1", "R1");
        verify(deletionTrace).logTaskCascade(WS, "U1", Arrays.asList("K1", "K2"),
                "关联分支「B1」已删除，自动解除关联");
        verify(deletionTrace).recordDelete(eq(WS), eq("U1"), eq("branch_delete"), eq("branch"), eq("B1"),
                eq("B1"), contains("删除分支「B1」（项目 R1"));
        verify(branchMapper).deleteById(WS, "B1");
    }

    @Test
    void deleteByOwnerDoesNotNotifySelf() {
        DevBranch b = branch("B1");
        b.setReqId("R1");
        b.setOwnerUserId("U2");
        when(branchMapper.selectById("B1")).thenReturn(b);

        service.delete("U2", WS, "B1");

        verifyNoInteractions(events);
        verify(branchMapper).deleteById(WS, "B1");
    }

    @Test
    void deleteSpaceLevelBranchChecksWriteWithoutProject() {
        DevBranch b = branch("B1");
        b.setReqId(null);
        when(branchMapper.selectById("B1")).thenReturn(b);

        service.delete("U1", WS, "B1");

        verify(access).assertView(WS, "U1", null);
        verify(access).assertWrite(WS, "U1", null);
        verify(branchMapper).deleteById(WS, "B1");
    }

    @Test
    void optionsClampsPageAndCountsWithSameQuery() {
        when(access.viewerScope(WS, "U1")).thenReturn("U1");
        when(branchMapper.countOptions(any(BranchQuery.class))).thenReturn(1);
        when(branchMapper.selectOptions(any(BranchQuery.class)))
                .thenReturn(Collections.singletonList(branch("B1")));

        PageResult<DevBranch> page = service.options(WS, "U1", " R1 ", -1, 500);

        assertEquals(1, page.getTotal());
        assertEquals(0, page.getOffset());
        assertEquals(100, page.getLimit());
        assertEquals("B1", page.getItems().get(0).getId());
        ArgumentCaptor<BranchQuery> countQuery = ArgumentCaptor.forClass(BranchQuery.class);
        ArgumentCaptor<BranchQuery> rowsQuery = ArgumentCaptor.forClass(BranchQuery.class);
        verify(branchMapper).countOptions(countQuery.capture());
        verify(branchMapper).selectOptions(rowsQuery.capture());
        assertEquals("R1", countQuery.getValue().getProjectId());
        assertEquals(rowsQuery.getValue().getOffset(), countQuery.getValue().getOffset());
        assertEquals(rowsQuery.getValue().getLimit(), countQuery.getValue().getLimit());
    }

    @Test
    void boardIncludesRepoCountsWithUnassignedBucket() {
        when(access.viewerScope(WS, "U1")).thenReturn("U1");
        java.util.Map<String, Object> bound = new java.util.HashMap<String, Object>();
        bound.put("repoId", "RP1");
        bound.put("cnt", 2);
        java.util.Map<String, Object> unassigned = new java.util.HashMap<String, Object>();
        unassigned.put("repoId", null);
        unassigned.put("cnt", 1);
        when(branchMapper.countGroupByRepo(any(BranchQuery.class)))
                .thenReturn(Arrays.asList(bound, unassigned));

        com.hourglass.dto.BranchBoard board = service.board(WS, "U1", new BranchQuery());

        assertEquals(Integer.valueOf(2), board.getRepoCounts().get("RP1"));
        assertEquals(Integer.valueOf(1), board.getRepoCounts().get("__none__"), "未绑定仓库的分支单列一桶");
        assertEquals(Integer.valueOf(3), board.getRepoCounts().get("all"));
    }

    @Test
    void createWithRepoBindsRepoAndSkipsManualNameCheck() {
        com.hourglass.entity.ProjectRepo repo = new com.hourglass.entity.ProjectRepo();
        repo.setId("RP1");
        repo.setWorkspaceId(WS);
        repo.setReqId("R1");
        when(repoMapper.selectById("RP1")).thenReturn(repo);
        com.hourglass.entity.Requirement project = new com.hourglass.entity.Requirement();
        project.setId("R1");
        project.setWorkspaceId(WS);
        when(requirementMapper.selectById("R1")).thenReturn(project);
        com.hourglass.dto.BranchSaveRequest req = new com.hourglass.dto.BranchSaveRequest();
        req.setName("feature/x");
        req.setReqId("R1");
        req.setRepoId("RP1");

        service.create("U1", WS, req);

        ArgumentCaptor<DevBranch> saved = ArgumentCaptor.forClass(DevBranch.class);
        verify(branchMapper).insert(saved.capture());
        assertEquals("RP1", saved.getValue().getRepoId(), "手工创建时可直接归属某个仓库");
        verify(branchMapper).selectByRepoAndName(WS, "RP1", "feature/x");
    }

    @Test
    void createRejectsRepoFromAnotherProject() {
        com.hourglass.entity.ProjectRepo repo = new com.hourglass.entity.ProjectRepo();
        repo.setId("RP1");
        repo.setWorkspaceId(WS);
        repo.setReqId("R2");
        when(repoMapper.selectById("RP1")).thenReturn(repo);
        com.hourglass.entity.Requirement project = new com.hourglass.entity.Requirement();
        project.setId("R1");
        project.setWorkspaceId(WS);
        when(requirementMapper.selectById("R1")).thenReturn(project);
        com.hourglass.dto.BranchSaveRequest req = new com.hourglass.dto.BranchSaveRequest();
        req.setName("feature/x");
        req.setReqId("R1");
        req.setRepoId("RP1");

        com.hourglass.common.AppException ex = org.junit.jupiter.api.Assertions.assertThrows(
                com.hourglass.common.AppException.class, () -> service.create("U1", WS, req));

        assertEquals(400, ex.getCode());
        verify(branchMapper, org.mockito.Mockito.never()).insert(any(DevBranch.class));
    }

    @Test
    void updateRejectsChangingRepo() {
        DevBranch b = branch("B1");
        b.setReqId("R1");
        b.setRepoId("RP1");
        when(branchMapper.selectById("B1")).thenReturn(b);
        com.hourglass.dto.BranchSaveRequest req = new com.hourglass.dto.BranchSaveRequest();
        req.setRepoId("RP2");

        com.hourglass.common.AppException ex = org.junit.jupiter.api.Assertions.assertThrows(
                com.hourglass.common.AppException.class, () -> service.update("U1", WS, "B1", req));

        assertEquals(400, ex.getCode(), "换仓库等于换远程事实，编辑接口不接");
    }

    private DevBranch branch(String id) {
        DevBranch b = new DevBranch();
        b.setId(id);
        b.setWorkspaceId(WS);
        b.setName(id);
        b.setStatus("dev");
        return b;
    }

    private BranchVersionTag tag(String branchId, String versionId, String name, String status,
                                 String reqId, String reqName) {
        BranchVersionTag t = new BranchVersionTag();
        t.setBranchId(branchId);
        t.setVersionId(versionId);
        t.setName(name);
        t.setStatus(status);
        t.setReqId(reqId);
        t.setReqName(reqName);
        return t;
    }

    private BranchProjectTag proj(String branchId, String projectId, String projectName) {
        BranchProjectTag p = new BranchProjectTag();
        p.setBranchId(branchId);
        p.setProjectId(projectId);
        p.setProjectName(projectName);
        return p;
    }
}
