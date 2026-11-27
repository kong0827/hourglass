package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.PageResult;
import com.hourglass.dto.TaskPublicationJudgementBatchRequest;
import com.hourglass.dto.TaskPublicationJudgementRequest;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskPublicationJudgement;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TaskPublicationJudgementMapper;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 人工发布标记只补录历史事实：需要管理权限、保留撤销历史、不写正式发布记录。
 */
class TaskPublicationJudgementServiceTest {

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskPublicationJudgementMapper judgements = mock(TaskPublicationJudgementMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final ReleasePermissionService permissions = mock(ReleasePermissionService.class);
    private final TaskAuditLogger audit = mock(TaskAuditLogger.class);
    private final TaskPublicationJudgementService service = new TaskPublicationJudgementService(
            tasks, judgements, users, access, permissions, audit);

    @BeforeEach
    void setup() {
        AppUser user = new AppUser();
        user.setId("U1");
        user.setDisplayName("张三");
        when(users.selectById("U1")).thenReturn(user);
        when(tasks.selectById("T1")).thenReturn(task("T1", "WI-001 登录超时"));
        when(tasks.selectById("T2")).thenReturn(task("T2", "WI-002 支付回调"));
    }

    private static Task task(String id, String title) {
        Task task = new Task();
        task.setId(id);
        task.setWorkspaceId("W1");
        task.setReqId("R1");
        task.setItemNo(1);
        task.setTitle(title);
        return task;
    }

    private TaskPublicationJudgementRequest body(LocalDate effectiveOn, String note) {
        TaskPublicationJudgementRequest body = new TaskPublicationJudgementRequest();
        body.setEffectiveOn(effectiveOn);
        body.setNote(note);
        return body;
    }

    private TaskPublicationJudgementBatchRequest batch(String note, String... taskIds) {
        TaskPublicationJudgementBatchRequest body = new TaskPublicationJudgementBatchRequest();
        body.setTaskIds(new ArrayList<String>(Arrays.asList(taskIds)));
        body.setEffectiveOn(LocalDate.now().minusDays(1));
        body.setNote(note);
        return body;
    }

    @Test
    void markStoresPublishedStateWithEffectiveDateAndReason() {
        service.mark("U1", "W1", "T1", body(LocalDate.now().minusDays(3), " 历史数据迁移 "));

        ArgumentCaptor<TaskPublicationJudgement> saved = ArgumentCaptor.forClass(TaskPublicationJudgement.class);
        verify(judgements).insert(saved.capture());
        assertEquals("published", saved.getValue().getJudgedState());
        assertEquals(LocalDate.now().minusDays(3), saved.getValue().getEffectiveOn());
        assertEquals("历史数据迁移", saved.getValue().getJudgeReason());
        assertEquals("张三", saved.getValue().getJudgedByName());
        verify(audit).log(eq("U1"), eq("W1"), eq("T1"), eq("update"), contains("历史数据迁移"));
        verify(permissions).assertJudgePublication("U1", "W1", "R1");
    }

    @Test
    void markRejectsFutureDateAndMissingReason() {
        assertEquals(400, assertThrows(AppException.class,
                () -> service.mark("U1", "W1", "T1", body(LocalDate.now().plusDays(1), "补录"))).getCode());
        assertEquals(400, assertThrows(AppException.class,
                () -> service.mark("U1", "W1", "T1", body(LocalDate.now(), "  "))).getCode());
        verify(judgements, never()).insert(any(TaskPublicationJudgement.class));
    }

    @Test
    void markRewritesPermissionMessageForNonManagers() {
        doThrow(new AppException(403, "空间把「人工标记工作项发布」限定为「空间主、管理员、项目负责人」"))
                .when(permissions).assertJudgePublication("U1", "W1", "R1");

        AppException error = assertThrows(AppException.class,
                () -> service.mark("U1", "W1", "T1", body(LocalDate.now(), "补录")));
        assertEquals(403, error.getCode());
        assertTrue(error.getMessage().contains("人工标记工作项发布"));
    }

    @Test
    void reMarkRevokesThePreviousActiveRowAndAppends() {
        TaskPublicationJudgement active = new TaskPublicationJudgement();
        active.setId(9L);
        when(judgements.selectActive("W1", "T1")).thenReturn(active);
        when(judgements.revoke(eq(9L), eq("U1"), eq("张三"), anyString())).thenReturn(1);

        service.mark("U1", "W1", "T1", body(LocalDate.now(), "补录"));

        verify(judgements).revoke(eq(9L), eq("U1"), eq("张三"), contains("重新标记"));
        verify(judgements).insert(any(TaskPublicationJudgement.class));
    }

    @Test
    void batchAllowsAtMostOneHundredTasks() {
        List<String> ids = new ArrayList<String>();
        for (int i = 0; i < 101; i++) ids.add("T" + i);

        AppException error = assertThrows(AppException.class, () -> service.markBatch("U1", "W1", batch("补录", ids.toArray(new String[0]))));
        assertEquals(400, error.getCode());
        assertTrue(error.getMessage().contains("100"));
        verify(judgements, never()).insert(any(TaskPublicationJudgement.class));
    }

    @Test
    void batchFailureNamesTheOffendingRow() {
        Task first = task("T1", "WI-001 登录超时");
        Task second = task("T2", "WI-002 支付回调");
        second.setReqId("R2");
        when(tasks.selectById("T1")).thenReturn(first);
        when(tasks.selectById("T2")).thenReturn(second);
        doThrow(new AppException(403, "forbidden")).when(permissions).assertJudgePublication("U1", "W1", "R2");

        AppException error = assertThrows(AppException.class,
                () -> service.markBatch("U1", "W1", batch("补录", "T1", "T2")));
        assertTrue(error.getMessage().contains("第 2 条"));
        assertTrue(error.getMessage().contains("WI-002"));
        verify(judgements, never()).insert(any(TaskPublicationJudgement.class));
    }

    @Test
    void batchMarksEverySelectedTask() {
        when(tasks.selectById("T1")).thenReturn(task("T1", "WI-001 登录超时"));
        when(tasks.selectById("T2")).thenReturn(task("T2", "WI-002 支付回调"));

        Map<String, Integer> result = service.markBatch("U1", "W1", batch("补录", "T1", "T2", "T1"));

        assertEquals(Integer.valueOf(2), result.get("marked"));
        verify(judgements, times(2)).insert(any(TaskPublicationJudgement.class));
    }

    @Test
    void revokeRequiresAnActiveRowAndReportsConcurrentRemoval() {
        assertEquals(400, assertThrows(AppException.class,
                () -> service.revoke("U1", "W1", "T1", body(null, "撤销"))).getCode());

        TaskPublicationJudgement active = new TaskPublicationJudgement();
        active.setId(9L);
        when(judgements.selectActive("W1", "T1")).thenReturn(active);
        when(judgements.revoke(eq(9L), anyString(), anyString(), anyString())).thenReturn(0);

        assertEquals(409, assertThrows(AppException.class,
                () -> service.revoke("U1", "W1", "T1", body(null, "撤销"))).getCode());
    }

    @Test
    void revokeSkipsTasksWithoutActiveMarkAndFailsWhenNothingToRevoke() {
        TaskPublicationJudgement active = new TaskPublicationJudgement();
        active.setId(9L);
        when(judgements.selectActive("W1", "T1")).thenReturn(active);
        when(judgements.revoke(eq(9L), anyString(), anyString(), anyString())).thenReturn(1);

        Map<String, Integer> result = service.revokeBatch("U1", "W1", batch("撤销", "T1", "T2"));
        assertEquals(Integer.valueOf(1), result.get("revoked"));
        verify(audit).log(eq("U1"), eq("W1"), eq("T1"), eq("update"), contains("撤销"));

        assertEquals(400, assertThrows(AppException.class,
                () -> service.revokeBatch("U1", "W1", batch("撤销", "T2"))).getCode());
    }

    @Test
    void historyKeepsDeletedTasksVisibleAndClampsPageSize() {
        Task deleted = task("T1", "WI-001 登录超时");
        deleted.setDeletedAt(java.time.LocalDateTime.now());
        when(tasks.selectById("T1")).thenReturn(deleted);
        when(judgements.countHistory("W1", "T1")).thenReturn(2);
        when(judgements.selectHistory("W1", "T1", 0, 100)).thenReturn(Collections.<TaskPublicationJudgement>emptyList());

        PageResult<TaskPublicationJudgement> page = service.history("W1", "U1", "T1", -5, 999);

        assertEquals(0, page.getOffset());
        assertEquals(100, page.getLimit());
        verify(access).assertViewTask("W1", "U1", deleted);
    }

    @Test
    void activeByTasksShortCircuitsEmptyInputAndBatchesLargeLists() {
        assertTrue(service.activeByTasks("W1", null).isEmpty());
        assertTrue(service.activeByTasks("W1", Collections.<String>emptyList()).isEmpty());
        verify(judgements, never()).selectActiveByTasks(anyString(), anyList());

        List<String> ids = new ArrayList<String>();
        for (int i = 0; i < 1200; i++) ids.add("T" + i);
        when(judgements.selectActiveByTasks(anyString(), anyList())).thenReturn(Collections.<TaskPublicationJudgement>emptyList());
        service.activeByTasks("W1", ids);
        verify(judgements, times(3)).selectActiveByTasks(anyString(), anyList());
    }
}
