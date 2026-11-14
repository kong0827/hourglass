package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.dto.MilestoneActionRequest;
import com.hourglass.dto.MilestoneSaveRequest;
import com.hourglass.dto.MilestoneTaskLink;
import com.hourglass.dto.MilestoneView;
import com.hourglass.entity.ProjectMilestone;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.VersionRelease;
import com.hourglass.mapper.ProjectMilestoneMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReleaseMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProjectMilestoneServiceTest {

    private static final String WS = "W1";
    private static final String REQ = "R1";
    private static final String USER = "U1";

    private final ProjectMilestoneMapper milestones = mock(ProjectMilestoneMapper.class);
    private final ProjectVersionMapper versions = mock(ProjectVersionMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final ReleaseMapper releases = mock(ReleaseMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final ProjectMilestoneService service = new ProjectMilestoneService(
            milestones, versions, tasks, reqs, releases, users, access);

    @Test
    void versionMilestoneIsAchievedOnlyByProductionSuccessAndMarksRollback() {
        ProjectMilestone milestone = milestone("M1", "version");
        milestone.setVersionId("V1");
        milestone.setTargetDate(LocalDate.of(2026, 12, 1));
        when(reqs.selectById(REQ)).thenReturn(requirement());
        when(milestones.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(milestone));
        when(versions.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(version("V1")));
        when(releases.selectRecords(WS, "V1")).thenReturn(Arrays.asList(
                release("REL1", "success", "production", "deploy", "full", Arrays.asList("prod-a"), null,
                        LocalDateTime.of(2026, 11, 1, 10, 0)),
                release("REL2", "success", "testing", "deploy", "full", Arrays.asList("test-a"), null,
                        LocalDateTime.of(2026, 11, 2, 10, 0)),
                release("REL3", "success", "production", "rollback", "full", Arrays.asList("prod-a"), "REL1",
                        LocalDateTime.of(2026, 11, 3, 10, 0))));

        MilestoneView view = service.list(WS, REQ, USER).get(0);

        assertEquals("achieved_rolled_back", view.getStatus());
        assertEquals(LocalDateTime.of(2026, 11, 1, 10, 0), view.getAchievedAt());
        assertEquals(Boolean.TRUE, view.getRolledBack());
        assertEquals("version", view.getAchievedSource());
        assertEquals(1, view.getReleaseCount(), "测试环境成功不计入发布证据");
    }

    @Test
    void redeployAfterRollbackRestoresAchievedAndReportsLatestRelease() {
        ProjectMilestone milestone = milestone("M1", "version");
        milestone.setVersionId("V1");
        when(reqs.selectById(REQ)).thenReturn(requirement());
        when(milestones.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(milestone));
        when(versions.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(version("V1")));
        when(releases.selectRecords(WS, "V1")).thenReturn(Arrays.asList(
                release("REL2", "success", "production", "rollback", "full", Arrays.asList("prod-a"), "REL1",
                        LocalDateTime.of(2026, 11, 3, 10, 0)),
                release("REL1", "success", "production", "deploy", "full", Arrays.asList("prod-a"), null,
                        LocalDateTime.of(2026, 11, 1, 10, 0)),
                release("REL3", "success", "production", "redeploy", "full", Arrays.asList("prod-a"), null,
                        LocalDateTime.of(2026, 11, 5, 10, 0))));

        MilestoneView view = service.list(WS, REQ, USER).get(0);

        assertEquals("achieved", view.getStatus(), "回滚后重新部署成功，版本重新生效");
        assertEquals(Boolean.FALSE, view.getRolledBack());
        assertEquals(LocalDateTime.of(2026, 11, 1, 10, 0), view.getAchievedAt());
        assertEquals(LocalDateTime.of(2026, 11, 5, 10, 0), view.getReleaseAt(), "证据展示最近一次成功发布");
        assertEquals(2, view.getReleaseCount());
    }

    @Test
    void partialCoverageSuccessDoesNotAchieveVersionMilestone() {
        ProjectMilestone milestone = milestone("M1", "version");
        milestone.setVersionId("V1");
        when(reqs.selectById(REQ)).thenReturn(requirement());
        when(milestones.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(milestone));
        when(versions.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(version("V1")));
        when(releases.selectRecords(WS, "V1")).thenReturn(Collections.singletonList(
                release("REL1", "success", "production", "deploy", "partial", Arrays.asList("prod-a"), null,
                        LocalDateTime.of(2026, 11, 1, 10, 0))));

        MilestoneView view = service.list(WS, REQ, USER).get(0);

        assertEquals("pending", view.getStatus());
        assertNull(view.getAchievedAt());
        assertEquals(0, view.getReleaseCount());
    }

    @Test
    void taskMilestoneRequiresAllTasksDoneAndReturnsToPendingWhenReopened() {
        ProjectMilestone milestone = milestone("M1", "tasks");
        when(reqs.selectById(REQ)).thenReturn(requirement());
        when(versions.selectByReq(WS, REQ)).thenReturn(Collections.<ProjectVersion>emptyList());
        when(milestones.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(milestone));
        MilestoneTaskLink first = link("M1", "T1");
        MilestoneTaskLink second = link("M1", "T2");
        when(milestones.selectTaskLinksByReq(WS, REQ)).thenReturn(Arrays.asList(first, second));
        Task done = task("T1", Consts.COL_DONE);
        done.setCompletedAt(LocalDate.of(2026, 11, 5));
        Task doing = task("T2", Consts.COL_DOING);
        when(tasks.selectByReq(WS, REQ)).thenReturn(Arrays.asList(done, doing));

        assertEquals("pending", service.list(WS, REQ, USER).get(0).getStatus());

        doing.setBoardColumn(Consts.COL_DONE);
        doing.setCompletedAt(LocalDate.of(2026, 11, 6));
        MilestoneView achieved = service.list(WS, REQ, USER).get(0);

        assertEquals("achieved", achieved.getStatus());
        assertEquals(LocalDateTime.of(2026, 11, 6, 0, 0), achieved.getAchievedAt());
        assertEquals(2, achieved.getDoneTaskCount());
    }

    @Test
    void automaticMilestonesCannotBeMarkedManually() {
        ProjectMilestone milestone = milestone("M1", "version");
        when(milestones.selectById(WS, "M1")).thenReturn(milestone);
        MilestoneActionRequest request = new MilestoneActionRequest();
        request.setRevision(0L);

        AppException error = assertThrows(AppException.class,
                () -> service.achieve(USER, WS, "M1", request));

        assertEquals(400, error.getCode());
        verify(milestones, never()).achieveManual(anyString(), anyString(), any(), anyString(), any());
    }

    @Test
    void rescheduleRequiresReasonBeforeWriting() {
        ProjectMilestone milestone = milestone("M1", "manual");
        when(milestones.selectById(WS, "M1")).thenReturn(milestone);
        MilestoneActionRequest request = new MilestoneActionRequest();
        request.setTargetDate(LocalDate.of(2026, 12, 20));
        request.setRevision(0L);

        AppException error = assertThrows(AppException.class,
                () -> service.reschedule(USER, WS, "M1", request));

        assertEquals(400, error.getCode());
        verify(milestones, never()).reschedule(anyString(), anyString(), any(), any());
    }

    @Test
    void createRejectsTaskThatDoesNotBelongToProject() {
        when(reqs.selectById(REQ)).thenReturn(requirement());
        when(milestones.verifyTasks(eq(WS), eq(REQ), any())).thenReturn(0);
        MilestoneSaveRequest request = new MilestoneSaveRequest();
        request.setReqId(REQ);
        request.setKind("tasks");
        request.setTaskIds(Collections.singletonList("T9"));

        AppException error = assertThrows(AppException.class,
                () -> service.create(USER, WS, request));

        assertEquals(400, error.getCode());
        verify(milestones, never()).insert(any(ProjectMilestone.class));
    }

    @Test
    void createDefaultsOwnerAndTargetDateFromVersion() {
        when(reqs.selectById(REQ)).thenReturn(requirement());
        when(versions.selectById("V1")).thenReturn(version("V1"));
        when(milestones.selectById(eq(WS), anyString())).thenAnswer(invocation -> {
            ProjectMilestone saved = new ProjectMilestone();
            saved.setId("M1");
            saved.setWorkspaceId(WS);
            saved.setReqId(REQ);
            saved.setName("V1.0 发布");
            saved.setKind("version");
            saved.setTargetDate(LocalDate.of(2026, 12, 1));
            saved.setOwnerUserId("U-owner");
            saved.setRevision(0L);
            return saved;
        });
        MilestoneSaveRequest request = new MilestoneSaveRequest();
        request.setReqId(REQ);
        request.setKind("version");
        request.setVersionId("V1");

        service.create(USER, WS, request);

        org.mockito.ArgumentCaptor<ProjectMilestone> captor =
                org.mockito.ArgumentCaptor.forClass(ProjectMilestone.class);
        verify(milestones).insert(captor.capture());
        assertEquals("V1.0 发布", captor.getValue().getName());
        assertEquals(LocalDate.of(2026, 12, 1), captor.getValue().getTargetDate());
        assertEquals("U-owner", captor.getValue().getOwnerUserId());
        assertEquals(Boolean.TRUE, captor.getValue().getKeyMilestone());
    }

    @Test
    void listedMilestoneWithoutEvidenceIsOverdueAfterTargetDate() {
        ProjectMilestone milestone = milestone("M1", "manual");
        milestone.setTargetDate(LocalDate.now().minusDays(3));
        when(reqs.selectById(REQ)).thenReturn(requirement());
        when(versions.selectByReq(WS, REQ)).thenReturn(Collections.<ProjectVersion>emptyList());
        when(milestones.selectByReq(WS, REQ)).thenReturn(Collections.singletonList(milestone));

        MilestoneView view = service.list(WS, REQ, USER).get(0);

        assertEquals("overdue", view.getStatus());
        assertNull(view.getAchievedAt());
    }

    private ProjectMilestone milestone(String id, String kind) {
        ProjectMilestone m = new ProjectMilestone();
        m.setId(id);
        m.setWorkspaceId(WS);
        m.setReqId(REQ);
        m.setName("里程碑");
        m.setKind(kind);
        m.setTargetDate(LocalDate.now().plusDays(10));
        m.setOwnerUserId("U-owner");
        m.setKeyMilestone(true);
        m.setRevision(0L);
        return m;
    }

    private Requirement requirement() {
        Requirement req = new Requirement();
        req.setId(REQ);
        req.setWorkspaceId(WS);
        req.setOwnerUserId("U-owner");
        return req;
    }

    private ProjectVersion version(String id) {
        ProjectVersion v = new ProjectVersion();
        v.setId(id);
        v.setWorkspaceId(WS);
        v.setReqId(REQ);
        v.setName("V1.0");
        v.setStatus("active");
        v.setTargetDate(LocalDate.of(2026, 12, 1));
        return v;
    }

    private Task task(String id, String column) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(WS);
        t.setReqId(REQ);
        t.setTitle(id);
        t.setBoardColumn(column);
        return t;
    }

    private MilestoneTaskLink link(String milestoneId, String taskId) {
        MilestoneTaskLink link = new MilestoneTaskLink();
        link.setMilestoneId(milestoneId);
        link.setTaskId(taskId);
        return link;
    }

    private VersionRelease release(String result, String environment, String operation, LocalDateTime at) {
        return release("REL-" + result + "-" + environment + "-" + operation, result, environment, operation,
                "full", Arrays.asList("prod-a"), null, at);
    }

    private VersionRelease release(String id, String result, String environment, String operation,
                                   String coverage, List<String> targets, String relatedReleaseId,
                                   LocalDateTime at) {
        VersionRelease r = new VersionRelease();
        r.setId(id);
        r.setResult(result);
        r.setEnvironment(environment);
        r.setOperation(operation);
        r.setCoverage(coverage);
        r.setTargetKeys(targets);
        r.setRelatedReleaseId(relatedReleaseId);
        r.setOccurredAt(at);
        return r;
    }
}
