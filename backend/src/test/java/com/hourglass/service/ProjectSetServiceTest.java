package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ProjectSetSaveRequest;
import com.hourglass.dto.ReqTaskAggRow;
import com.hourglass.entity.ProjectSet;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectSetMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProjectSetServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final ProjectSetMapper sets = mock(ProjectSetMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final AuditService audit = mock(AuditService.class);
    private final ProjectSetService service = new ProjectSetService(sets, reqs, tasks, members, access, audit);

    @Test
    void listFiltersHiddenProjectsAndAggregatesVisibleOnly() {
        when(access.canManage(WS, USER)).thenReturn(false);
        when(access.hiddenProjectIds(WS, USER)).thenReturn(new HashSet<String>(Collections.singletonList("P2")));
        when(sets.selectAll(WS)).thenReturn(Arrays.asList(set("S1", "流程引擎", 0), set("S2", "不可见集", 1)));
        when(reqs.selectAll(WS)).thenReturn(Arrays.asList(
                requirement("P1", "S1", false), requirement("P2", "S1", false), requirement("P3", "S1", true)));
        when(tasks.countByReq(WS)).thenReturn(Arrays.asList(agg("P1", 4, 2, 200), agg("P2", 9, 9, 900), agg("P3", 1, 0, 50)));
        WorkspaceMember owner = new WorkspaceMember();
        owner.setUserId(USER);
        owner.setDisplayName("孔祥金");
        when(members.selectByWorkspace(WS)).thenReturn(Collections.singletonList(owner));

        List<ProjectSet> visible = service.list(WS, USER);

        assertEquals(1, visible.size(), "没有可见项目的集不向普通成员暴露");
        ProjectSet s1 = visible.get(0);
        assertEquals("S1", s1.getId());
        assertEquals("孔祥金", s1.getOwnerName());
        assertEquals(Integer.valueOf(2), s1.getProjectCount(), "P2 不可见，不计入");
        assertEquals(Integer.valueOf(5), s1.getTaskCount(), "任务汇总只算可见项目");
        assertEquals(Integer.valueOf(2), s1.getDoneCount());
        assertEquals(Integer.valueOf(50), s1.getProgressPct(), "(200+50)÷5");
    }

    @Test
    void managerSeesEmptySets() {
        when(access.canManage(WS, USER)).thenReturn(true);
        when(sets.selectAll(WS)).thenReturn(Collections.singletonList(set("S1", "空集", 0)));
        when(reqs.selectAll(WS)).thenReturn(Collections.<Requirement>emptyList());
        when(tasks.countByReq(WS)).thenReturn(Collections.<ReqTaskAggRow>emptyList());
        when(members.selectByWorkspace(WS)).thenReturn(Collections.<WorkspaceMember>emptyList());

        List<ProjectSet> visible = service.list(WS, USER);

        assertEquals(1, visible.size());
        assertEquals(Integer.valueOf(0), visible.get(0).getProjectCount());
    }

    @Test
    void createRejectsNonManagerAndDuplicateName() {
        assertThrows(AppException.class, () -> service.create(WS, USER, request("流程引擎")));

        when(access.canManage(WS, USER)).thenReturn(true);
        when(sets.countByName(WS, "流程引擎", null)).thenReturn(1);
        AppException ex = assertThrows(AppException.class, () -> service.create(WS, USER, request("流程引擎")));
        assertEquals(409, ex.getCode());
        verify(sets, never()).insert(any(ProjectSet.class));
    }

    @Test
    void createAssignsDefaultsAndSortOrder() {
        when(access.canManage(WS, USER)).thenReturn(true);
        when(sets.selectMaxSortOrder(WS)).thenReturn(4);
        ProjectSet saved = set("PS1", "流程引擎", 5);
        when(sets.selectById(anyString(), anyString())).thenReturn(saved);

        ProjectSetSaveRequest req = request("流程引擎");
        req.setOwnerUserId(null);
        ProjectSet created = service.create(WS, USER, req);

        verify(sets).insert(any(ProjectSet.class));
        assertEquals("流程引擎", created.getName());
        verify(audit).recordCurrent(anyString(), anyString(), anyString(), anyString(),
                anyString(), org.mockito.ArgumentMatchers.eq(true), anyString(),
                org.mockito.ArgumentMatchers.isNull());
    }

    @Test
    void deleteOnlyUnbindsProjects() {
        when(access.canManage(WS, USER)).thenReturn(true);
        when(sets.selectById(WS, "S1")).thenReturn(set("S1", "流程引擎", 0));
        when(sets.unbindProjects(WS, "S1")).thenReturn(3);

        service.delete(WS, USER, "S1");

        verify(sets).unbindProjects(WS, "S1");
        verify(sets).deleteById(WS, "S1");
        verify(reqs, never()).deleteById(anyString());
    }

    @Test
    void normalizeSetIdChecksOwnership() {
        when(sets.selectById(WS, "S1")).thenReturn(set("S1", "流程引擎", 0));
        assertEquals("S1", service.normalizeSetId(WS, " S1 "));
        assertEquals("S1", service.normalizeSetId(WS, "S1"));
        assertNull(service.normalizeSetId(WS, "  "));
        AppException ex = assertThrows(AppException.class, () -> service.normalizeSetId(WS, "S9"));
        assertEquals(400, ex.getCode());
    }

    @Test
    void updateUsesOptimisticLock() {
        when(access.canManage(WS, USER)).thenReturn(true);
        when(sets.selectById(WS, "S1")).thenReturn(set("S1", "旧名", 0));
        when(sets.update(any(ProjectSet.class))).thenReturn(0);
        ProjectSetSaveRequest req = request("新名");

        AppException ex = assertThrows(AppException.class, () -> service.update(WS, USER, "S1", req));
        assertEquals(409, ex.getCode());
    }

    private static ProjectSetSaveRequest request(String name) {
        ProjectSetSaveRequest req = new ProjectSetSaveRequest();
        req.setName(name);
        return req;
    }

    private static ProjectSet set(String id, String name, int sort) {
        ProjectSet s = new ProjectSet();
        s.setId(id);
        s.setWorkspaceId(WS);
        s.setName(name);
        s.setStatus("active");
        s.setColor("#8a8578");
        s.setSortOrder(sort);
        s.setOwnerUserId(USER);
        return s;
    }

    private static Requirement requirement(String id, String setId, boolean container) {
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(WS);
        r.setSetId(setId);
        r.setContainerKind(container ? "split_container" : null);
        r.setName(id);
        return r;
    }

    private static ReqTaskAggRow agg(String reqId, int total, int done, int progressSum) {
        ReqTaskAggRow row = new ReqTaskAggRow();
        row.setReqId(reqId);
        row.setTotal(total);
        row.setDone(done);
        row.setProgressSum(progressSum);
        return row;
    }
}
