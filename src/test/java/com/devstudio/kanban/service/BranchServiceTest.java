package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.BranchProjectTag;
import com.devstudio.kanban.dto.BranchStatusRequest;
import com.devstudio.kanban.dto.BranchVersionTag;
import com.devstudio.kanban.entity.DevBranch;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class BranchServiceTest {

    private static final String WS = "W1";

    private final DevBranchMapper branchMapper = mock(DevBranchMapper.class);
    private final TaskMapper taskMapper = mock(TaskMapper.class);
    private final UserMapper userMapper = mock(UserMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final RequirementMapper requirementMapper = mock(RequirementMapper.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final BranchService service = new BranchService(branchMapper, taskMapper, userMapper, access,
            requirementMapper, events);

    @Test
    void listFillsDerivedVersionTagsSortedByVersionLifecycle() {
        when(access.viewerScope(WS, "U1")).thenReturn("U1");
        when(branchMapper.selectVisibleByWorkspace(WS, "U1", null)).thenReturn(Arrays.asList(
                branch("B1"), branch("B2")));
        when(branchMapper.selectVersionTags(WS, "U1")).thenReturn(Arrays.asList(
                tag("B1", "V2", "v2.0", "released", "R1", "项目A"),
                tag("B1", "V1", "v1.0", "active", "R1", "项目A"),
                tag("B2", "V3", "v1.0", "planned", "R2", "项目B")));
        when(branchMapper.selectProjectTags(WS, "U1")).thenReturn(Arrays.asList(
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
        when(branchMapper.selectVersionTags(WS, null)).thenReturn(Collections.singletonList(
                tag("B2", "V3", "v1.0", "planned", "R2", "项目B")));
        when(branchMapper.selectProjectTags(WS, null)).thenReturn(Collections.singletonList(
                proj("B2", "R2", "项目B")));

        assertEquals(1, service.getDetail(WS, "U9", "B2").getVersions().size());
        assertNull(service.getDetail(WS, "U9", "B1").getVersions(), "无版本任务的分支不填该字段");
    }

    @Test
    void listByProjectFiltersBranchesByDerivedProjectTag() {
        when(access.viewerScope(WS, "U1")).thenReturn("U1");
        when(branchMapper.selectVisibleByWorkspace(WS, "U1", "R1")).thenReturn(Arrays.asList(
                branch("B1"), branch("B2"), branch("B3")));
        when(branchMapper.selectVersionTags(WS, "U1")).thenReturn(Collections.emptyList());
        when(branchMapper.selectProjectTags(WS, "U1")).thenReturn(Arrays.asList(
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
        when(branchMapper.selectVersionTags(WS, "U1")).thenReturn(Collections.emptyList());
        when(branchMapper.selectProjectTags(WS, "U1")).thenReturn(Collections.singletonList(
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
        when(branchMapper.selectVersionTags(WS, "U1")).thenReturn(Collections.emptyList());
        when(branchMapper.selectProjectTags(WS, "U1")).thenReturn(Collections.emptyList());

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

        verify(events).notify("U2", WS, UserNotificationPreferenceService.BRANCH_STATUS,
                "分支「B1」状态变更", "开发中 → 待测试", "B1", "R1");
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

        service.delete("U1", WS, "B1");

        verify(events).notify("U2", WS, UserNotificationPreferenceService.BRANCH_STATUS,
                "分支「B1」已被删除", "分支及其时间线已被删除，关联任务已解绑", null, "R1");
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
