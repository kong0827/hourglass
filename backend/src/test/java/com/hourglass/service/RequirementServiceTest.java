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
            mock(com.hourglass.mapper.WorkspaceMemberMapper.class));

    @Test
    void listBatchesVersionCountsAndFiltersHiddenProjects() {
        when(reqs.selectAll(WS)).thenReturn(Arrays.asList(requirement("R1", "项目一"),
                requirement("R2", "隐藏项目")));
        when(access.hiddenProjectIds(WS, VIEWER)).thenReturn(Collections.singleton("R2"));

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

        Demand demand = new Demand();
        demand.setId("D1");
        demand.setReqId("R1");
        when(demands.selectByWorkspace(WS)).thenReturn(Collections.singletonList(demand));

        List<ReqProgress> list = service.list(WS, VIEWER);

        assertEquals(1, list.size(), "隐藏项目不出现在项目列表");
        ReqProgress progress = list.get(0);
        assertEquals("R1", progress.getId());
        assertEquals(75, progress.getProgressPct(), "进度=进度和÷任务数");
        assertEquals(3, progress.getDocCount());
        assertEquals(2, progress.getVersionCount());
        assertEquals(1, progress.getDemandCount());

        verify(reqs, times(1)).selectAll(WS);
        verify(versions, never()).selectByReq(anyString(), anyString());
    }

    @Test
    void deleteCascadesVersionsDemandsAndUnlinksTasks() {
        Requirement project = requirement("R1", "项目一");
        when(reqs.selectById("R1")).thenReturn(project);
        when(docs.countByReq(WS, "R1")).thenReturn(2);
        when(versions.selectByReq(WS, "R1")).thenReturn(Arrays.asList(version("V1"), version("V2")));
        when(demands.selectByReq(WS, "R1")).thenReturn(Collections.singletonList(new Demand()));
        when(tasks.countTasksByReq(WS, "R1")).thenReturn(1);

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
        verify(demands).deleteByReq(WS, "R1");
        verify(access).clearProject(WS, "R1");
        verify(reqs).deleteById("R1");
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
