package com.hourglass.service;

import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.ReqTaskAggRow;
import com.hourglass.dto.RequirementDeleteResult;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RequirementServiceTest {

    private static final String WS = "W1";
    private static final String VIEWER = "U1";

    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskLogMapper logs = mock(TaskLogMapper.class);
    private final ActivityService activity = mock(ActivityService.class);
    private final WorkActivityService workActivity = mock(WorkActivityService.class);
    private final RequirementDocService docs = mock(RequirementDocService.class);
    private final ProjectVersionService versionService = mock(ProjectVersionService.class);
    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final DemandMapper demands = mock(DemandMapper.class);
    private final DevBranchMapper branches = mock(DevBranchMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final RequirementService service = new RequirementService(reqs, tasks, logs, activity,
            workActivity, docs, versionService, versions, demands, branches, access,
            mock(AttachmentService.class), mock(com.hourglass.mapper.MailDeliveryMapper.class),
            mock(TestCaseService.class), mock(ProjectTemplateService.class),
            mock(com.hourglass.mapper.WorkspaceMemberMapper.class), mock(CategoryService.class));

    @Test
    void listBatchesVersionCountsAndReadsVisibleProjects() {
        when(access.viewerScope(WS, VIEWER)).thenReturn(VIEWER);
        when(reqs.countVisible(WS, VIEWER)).thenReturn(1);
        when(reqs.selectPage(WS, VIEWER, 0, 100))
                .thenReturn(Collections.singletonList(requirement("R1", "项目一")));

        ReqTaskAggRow agg = new ReqTaskAggRow();
        agg.setReqId("R1");
        agg.setTotal(2);
        agg.setDone(1);
        agg.setProgressSum(150);
        when(tasks.countByReq(WS)).thenReturn(Collections.singletonList(agg));
        when(docs.countByReqMap(WS)).thenReturn(Collections.singletonMap("R1", 3));

        Map<String, Object> versionRow = new HashMap<String, Object>();
        versionRow.put("reqId", "R1");
        versionRow.put("cnt", 2L);
        when(versions.countGroupByReq(WS)).thenReturn(Collections.singletonList(versionRow));

        Map<String, Object> demandRow = new HashMap<String, Object>();
        demandRow.put("reqId", "R1");
        demandRow.put("cnt", 1L);
        when(demands.countGroupByReq(WS)).thenReturn(Collections.singletonList(demandRow));

        List<ReqProgress> list = service.list(WS, VIEWER);

        assertEquals(1, list.size(), "隐藏项目不出现在项目列表");
        ReqProgress progress = list.get(0);
        assertEquals("R1", progress.getId());
        assertEquals(75, progress.getProgressPct(), "进度=进度和÷任务数");
        assertEquals(3, progress.getDocCount());
        assertEquals(2, progress.getVersionCount());
        assertEquals(1, progress.getDemandCount());

        verify(reqs, times(1)).selectPage(WS, VIEWER, 0, 100);
        verify(reqs, never()).selectAll(WS);
        verify(versions, never()).selectByReq(anyString(), anyString());
        verify(demands, never()).selectByWorkspace(WS);
    }

    @Test
    void deleteCascadesVersionsDemandsAndUnlinksTasks() {
        Requirement project = requirement("R1", "项目一");
        when(reqs.selectById("R1")).thenReturn(project);
        when(docs.countByReq(WS, "R1")).thenReturn(2);
        when(versions.selectByReq(WS, "R1")).thenReturn(Arrays.asList(version("V1"), version("V2")));
        when(demands.selectByReq(WS, "R1")).thenReturn(Collections.singletonList(new Demand()));
        when(tasks.countTasksByReq(WS, "R1")).thenReturn(1);
        com.hourglass.mapper.InviteProjectGrantMapper inviteGrants =
                mock(com.hourglass.mapper.InviteProjectGrantMapper.class);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "inviteGrantMapper", inviteGrants);
        com.hourglass.mapper.DemandDeliveryJudgementMapper judgements =
                mock(com.hourglass.mapper.DemandDeliveryJudgementMapper.class);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "demandJudgementMapper", judgements);

        RequirementDeleteResult result = service.delete(VIEWER, WS, "R1");

        assertEquals(1, result.getUnlinked());
        assertEquals(2, result.getDocs());
        assertEquals(2, result.getVersions());
        assertEquals(1, result.getDemands());

        verify(logs).insertUnlinkReqLogs(WS, "R1", VIEWER,
                "解除与已删除项目「项目一」的关联");
        verify(tasks).clearReq(WS, "R1");
        verify(docs).deleteByReq(WS, "R1");
        verify(versionService).deleteByReq(WS, "R1");
        verify(demands).deleteLogsByReq(WS, "R1");
        verify(judgements).deleteByReq(WS, "R1");
        verify(demands).deleteByReq(WS, "R1");
        verify(access).clearProject(WS, "R1");
        /* 邀请上对该项目的预分配同步清掉，避免残留授权 */
        verify(inviteGrants).deleteByProject(WS, "R1");
        verify(reqs).deleteById("R1");
    }

    @Test
    void staleUpdateTokenIsRejectedInsteadOfOverwriting() {
        when(reqs.selectById("R1")).thenReturn(requirement("R1", "项目一"));
        when(reqs.update(any(Requirement.class))).thenReturn(0);
        com.hourglass.dto.ReqSaveRequest req = new com.hourglass.dto.ReqSaveRequest();
        req.setName("项目一改");
        req.setUpdatedAt(java.time.LocalDateTime.of(2026, 11, 1, 10, 0));

        com.hourglass.common.AppException ex = assertThrows(com.hourglass.common.AppException.class,
                () -> service.update(WS, VIEWER, "R1", req));

        assertEquals(409, ex.getCode());
        verify(reqs).update(org.mockito.ArgumentMatchers.argThat(r ->
                WS.equals(r.getWorkspaceId())
                        && java.time.LocalDateTime.of(2026, 11, 1, 10, 0).equals(r.getUpdatedAt())));
    }

    @Test
    void deleteImpactRequiresProjectViewAccess() {
        when(reqs.selectById("R1")).thenReturn(requirement("R1", "项目一"));
        doThrow(com.hourglass.common.AppException.notFound("项目不存在"))
                .when(access).assertView(WS, VIEWER, "R1");

        assertThrows(com.hourglass.common.AppException.class, () -> service.deleteImpact(WS, VIEWER, "R1"));

        verify(tasks, never()).countTasksByReq(anyString(), anyString());
    }

    private Requirement requirement(String id, String name) {
        Requirement r = new Requirement();
        r.setId(id);
        r.setWorkspaceId(WS);
        r.setName(name);
        r.setStatus("active");
        return r;
    }

    private ProjectVersion version(String id) {
        ProjectVersion v = new ProjectVersion();
        v.setId(id);
        v.setWorkspaceId(WS);
        v.setReqId("R1");
        return v;
    }
}
