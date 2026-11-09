package com.hourglass.service;

import com.hourglass.common.Consts;
import com.hourglass.dto.BoardQuery;
import com.hourglass.dto.GanttQuery;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.Task;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.AttachmentMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TagMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 详情和列表只投影正式发布事实，不提供任务级人工发布操作。 */
class TaskQueryServiceReleasePermissionTest {
    private static final String WS = "W1";
    private static final String REQ = "R1";
    private static final String USER = "U1";
    private static final LocalDate COMPLETED = LocalDate.of(2026, 11, 8);

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final VersionTaskMapper versions = mock(VersionTaskMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final Task task = task("T1");
    private final com.hourglass.mapper.ReleaseMapper records = mock(com.hourglass.mapper.ReleaseMapper.class);
    private final TaskPublicationService publications = new TaskPublicationService(tasks, records,
            mock(TaskLogMapper.class), mock(DeliveryScopeLock.class), permissions,
            new com.fasterxml.jackson.databind.ObjectMapper());

    @BeforeEach
    void readableTask() {
        when(tasks.selectByIdInMyWorkspaces("T1", USER)).thenReturn(task);
        when(access.canViewTask(WS, USER, task)).thenReturn(true);
        org.mockito.Mockito.doCallRealMethod().when(versions).enrichTasks(anyString(), anyList());
        com.hourglass.dto.TaskVersionBinding row = new com.hourglass.dto.TaskVersionBinding();
        row.setTaskId("T1"); row.setVersionId("V1"); row.setVersionName("首版");
        when(versions.selectVersionRowsByTaskIds(WS, Collections.singletonList("T1")))
                .thenReturn(Collections.singletonList(row));
    }

    @Test
    void completedUnpublishedDetailHasVersionArraysButNoPublicationActions() {

        Task result = service(permissions).forDeepLink(USER, "T1");

        assertSame(task, result);
        assertFalse(result.getCanPublish());
        assertFalse(result.getCanUnpublish());
        verifyNoInteractions(permissions);
        verify(versions).selectVersionRowsByTaskIds(WS, Collections.singletonList("T1"));
        org.junit.jupiter.api.Assertions.assertEquals(Collections.singletonList("V1"), result.getVersionIds());
    }

    @Test
    void manualTimestampAndCompletionCannotCreatePublicationBadgeOrActions() {
        task.setPublishedAt(COMPLETED.plusDays(1));

        Task result = service(permissions).forDeepLink(USER, "T1");
        assertFalse(result.getCanPublish());
        assertFalse(result.getCanUnpublish());
        assertNull(result.getPublishedAt(), "人工时间戳不能产生正式徽标");

        task.setPublishedAt(null);
        task.setCompletedAt(null);
        result = service(permissions).forDeepLink(USER, "T1");
        assertFalse(result.getCanPublish());
        assertFalse(result.getCanUnpublish());

        task.setCompletedAt(COMPLETED);
        task.setBoardColumn(Consts.COL_DOING);
        assertFalse(service(permissions).forDeepLink(USER, "T1").getCanPublish());
    }

    @Test
    void missingOrBlankIdentityAndDeletedTaskNeverReceivePublicationPermissions() {
        when(tasks.selectByIdInMyWorkspaces("T1", null)).thenReturn(task);
        when(access.canViewTask(WS, null, task)).thenReturn(true);
        TaskQueryService service = service(permissions);
        assertFalse(service.forDeepLink(null, "T1").getCanPublish());
        assertFalse(task.getCanUnpublish());

        when(tasks.selectByIdInMyWorkspaces("T1", " ")).thenReturn(task);
        when(access.canViewTask(WS, " ", task)).thenReturn(true);
        task.setPublishedAt(COMPLETED.plusDays(1));
        assertFalse(service.forDeepLink(" ", "T1").getCanUnpublish());

        task.setDeletedAt(LocalDateTime.now());
        assertFalse(service.forDeepLink(USER, "T1").getCanUnpublish());
        assertFalse(task.getCanPublish());
        verifyNoInteractions(permissions);
    }

    @Test
    void invisibleTaskIsNotReturnedOrPassedToPublicationPermissions() {
        when(access.canViewTask(WS, USER, task)).thenReturn(false);

        assertNull(service(permissions).forDeepLink(USER, "T1"));
        assertNull(service(permissions).forDeepLink(USER, "missing"));
        verifyNoInteractions(permissions, versions);
    }

    @Test
    void actualPermissionChecksStrictOwnerIdentityAndWritableProject() {
        WorkspaceMember member = new WorkspaceMember();
        member.setRole("member");
        when(members.selectMember(WS, USER)).thenReturn(member);
        when(access.canWrite(WS, USER, REQ)).thenReturn(true);
        Requirement project = new Requirement();
        project.setWorkspaceId(WS);
        project.setOwnerUserId("PM");
        when(reqs.selectById(REQ)).thenReturn(project);
        ReleasePermissionService actual = new ReleasePermissionService(members, reqs, access);
        TaskQueryService service = service(actual);

        task.setOwnerUserId("OTHER");
        task.setOwner("同名负责人");
        assertFalse(service.forDeepLink(USER, "T1").getCanPublish(), "显示名不参与发布鉴权");
        task.setOwnerUserId(null);
        assertFalse(service.forDeepLink(USER, "T1").getCanPublish());
        task.setOwnerUserId(USER);
        assertFalse(service.forDeepLink(USER, "T1").getCanPublish());

        when(access.canWrite(WS, USER, REQ)).thenReturn(false);
        assertFalse(service.forDeepLink(USER, "T1").getCanPublish());
        task.setPublishedAt(COMPLETED.plusDays(1));
        assertFalse(service.forDeepLink(USER, "T1").getCanUnpublish(), "只读项目即使是任务负责人也不能撤回");
        when(access.canWrite(WS, USER, REQ)).thenReturn(true);
        member.setRole("viewer");
        assertFalse(service.forDeepLink(USER, "T1").getCanUnpublish());

        member.setRole("member");
        project.setOwnerUserId(USER);
        task.setOwnerUserId("OTHER");
        assertFalse(service.forDeepLink(USER, "T1").getCanUnpublish(), "即使项目负责人也没有人工徽标操作入口");
        member.setRole("admin");
        project.setOwnerUserId("PM");
        assertFalse(service.forDeepLink(USER, "T1").getCanUnpublish());
    }

    @Test
    void listStillLoadsVersionBindingsInBatchWithoutPerTaskPublicationChecks() {
        Task second = task("T2");
        when(tasks.countTaskList(eq(WS), any(GanttQuery.class))).thenReturn(2);
        when(tasks.selectTaskList(eq(WS), any(GanttQuery.class), anyList(), eq("due"), anyInt(), anyInt()))
                .thenReturn(Arrays.asList(task, second));
        when(versions.selectVersionRowsByTaskIds(WS, Arrays.asList("T1", "T2")))
                .thenReturn(Collections.emptyList());

        TaskListResponse result = service(permissions).list(WS, USER, new BoardQuery(), "due");

        assertSame(task, result.getItems().get(0));
        verify(versions).selectVersionRowsByTaskIds(WS, Arrays.asList("T1", "T2"));
        verify(versions, never()).selectVersionIdsByTask(anyString(), anyString());
        org.junit.jupiter.api.Assertions.assertEquals(2, result.getItems().size());
        org.junit.jupiter.api.Assertions.assertEquals(Collections.emptyList(), second.getVersionIds());
        verifyNoInteractions(permissions);
    }

    @Test
    void formalSuccessAndRollbackRemainVisibleAfterReopenRegardlessOfManualDates() {
        com.hourglass.entity.VersionRelease deploy = publication("REL-1", "deploy", "published", COMPLETED);
        com.hourglass.entity.VersionRelease rollback = publication("REL-2", "rollback", "rolled_back", COMPLETED.plusDays(1));
        rollback.setRelatedReleaseId("REL-1");
        when(records.selectPublicationRecords(WS, Collections.singletonList("T1")))
                .thenReturn(Collections.singletonList(deploy));
        task.setBoardColumn(Consts.COL_DOING);
        task.setCompletedAt(null);
        task.setPublishedAt(COMPLETED.minusYears(1));

        Task result = service(permissions).forDeepLink(USER, "T1");
        org.junit.jupiter.api.Assertions.assertEquals(COMPLETED, result.getPublishedAt());
        org.junit.jupiter.api.Assertions.assertEquals("record", result.getPublishSource());
        org.junit.jupiter.api.Assertions.assertEquals("REL-1", result.getPublishedReleaseId());
        org.junit.jupiter.api.Assertions.assertEquals("effective", result.getPublicationState());
        assertTrue(result.getEverPublished());
        assertFalse(result.getCanPublish());
        assertFalse(result.getCanUnpublish());

        when(records.selectPublicationRecords(WS, Collections.singletonList("T1")))
                .thenReturn(Arrays.asList(rollback, deploy));
        result = service(permissions).forDeepLink(USER, "T1");
        assertNull(result.getPublishedAt());
        assertNull(result.getPublishedReleaseId());
        assertNull(result.getPublishSource());
        assertTrue(result.getEverPublished());
        org.junit.jupiter.api.Assertions.assertEquals("rolled_back", result.getPublicationState());
        org.junit.jupiter.api.Assertions.assertEquals(Collections.singletonList("V1"), result.getVersionIds());
        assertFalse(result.getCanPublish());
        assertFalse(result.getCanUnpublish());
        verifyNoInteractions(permissions);
    }

    private com.hourglass.entity.VersionRelease publication(String id, String operation, String disposition, LocalDate day) {
        com.hourglass.entity.VersionRelease record = new com.hourglass.entity.VersionRelease();
        record.setId(id); record.setWorkspaceId(WS); record.setVersionId("V1");
        record.setResult("success"); record.setEnvironment("production"); record.setOperation(operation);
        record.setCoverage("full"); record.setTargetKeys(Collections.singletonList("main"));
        record.setOccurredAt(day.atStartOfDay()); record.setRecordedAt(day.atTime(12, 0));
        com.hourglass.entity.VersionReleaseItem item = new com.hourglass.entity.VersionReleaseItem();
        item.setTaskId("T1"); item.setDisposition(disposition);
        record.setItems(Collections.singletonList(item));
        return record;
    }

    private TaskQueryService service(ReleasePermissionService releasePermissions) {
        TaskQueryService service = new TaskQueryService(tasks, reqs, mock(ProjectVersionMapper.class), mock(TaskLogMapper.class),
                mock(SubtaskMapper.class), mock(TagMapper.class), mock(TimeLogMapper.class),
                mock(AttachmentMapper.class), mock(WorkspaceMetaCache.class), mock(TaskSupport.class),
                versions, access, releasePermissions);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "publications", publications);
        return service;
    }

    private static Task task(String id) {
        Task task = new Task();
        task.setId(id);
        task.setWorkspaceId(WS);
        task.setReqId(REQ);
        task.setOwnerUserId(USER);
        task.setBoardColumn(Consts.COL_DONE);
        task.setCompletedAt(COMPLETED);
        return task;
    }
}
