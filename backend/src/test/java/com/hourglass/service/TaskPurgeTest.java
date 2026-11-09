package com.hourglass.service;

import com.hourglass.entity.Task;
import com.hourglass.mapper.AppNotificationMapper;
import com.hourglass.mapper.AttachmentMapper;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.GanttShareMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TagMapper;
import com.hourglass.mapper.TaskBaselineMapper;
import com.hourglass.mapper.TaskCommentMapper;
import com.hourglass.mapper.TaskDependencyMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SuppressWarnings("unchecked")
class TaskPurgeTest {

    private TaskMapper taskMapper;
    private SubtaskMapper subtaskMapper;
    private TagMapper tagMapper;
    private TimeLogMapper timeLogMapper;
    private TaskLogMapper logMapper;
    private TaskCommentMapper commentMapper;
    private AppNotificationMapper notificationMapper;
    private TaskDependencyMapper dependencyMapper;
    private TaskBaselineMapper baselineMapper;
    private AttachmentService attachmentService;
    private PlatformTransactionManager transactionManager;
    private TaskTrashService service;
    private DeliveryScopeLock scopeLock;

    @BeforeEach
    void setUp() {
        taskMapper = mock(TaskMapper.class);
        scopeLock = mock(DeliveryScopeLock.class);
        subtaskMapper = mock(SubtaskMapper.class);
        tagMapper = mock(TagMapper.class);
        timeLogMapper = mock(TimeLogMapper.class);
        logMapper = mock(TaskLogMapper.class);
        commentMapper = mock(TaskCommentMapper.class);
        notificationMapper = mock(AppNotificationMapper.class);
        dependencyMapper = mock(TaskDependencyMapper.class);
        baselineMapper = mock(TaskBaselineMapper.class);
        attachmentService = mock(AttachmentService.class);
        transactionManager = mock(PlatformTransactionManager.class);
        TransactionStatus status = new SimpleTransactionStatus();
        when(transactionManager.getTransaction(any(TransactionDefinition.class))).thenReturn(status);

        TaskCascade cascade = new TaskCascade(taskMapper, logMapper, commentMapper,
                mock(com.hourglass.mapper.TaskWatchMapper.class), notificationMapper, subtaskMapper,
                tagMapper, timeLogMapper, attachmentService, dependencyMapper, baselineMapper,
                mock(GanttShareMapper.class), mock(RequirementMapper.class),
                mock(RequirementDocMapper.class),
                mock(com.hourglass.mapper.RequirementDocHistoryMapper.class),
                mock(com.hourglass.mapper.RequirementDocCommentMapper.class),
                mock(TaskCompletionService.class),
                mock(DevBranchMapper.class), mock(VersionTaskMapper.class),
                mock(ProjectVersionMapper.class), mock(DemandMapper.class),
                mock(com.hourglass.mapper.MailDeliveryMapper.class),
                mock(com.hourglass.mapper.ReqDocShareMapper.class),
                mock(com.hourglass.mapper.TestCaseMapper.class),
                mock(com.hourglass.mapper.TestCaseRunMapper.class), scopeLock);
        TaskSupport support = new TaskSupport(taskMapper, tagMapper, mock(WorkspaceMetaCache.class));
        service = new TaskTrashService(taskMapper, support, cascade, mock(TimeLogService.class),
                new TaskAuditLogger(logMapper, mock(RequirementMapper.class), mock(WorkspaceMetaCache.class),
                        new com.fasterxml.jackson.databind.ObjectMapper()), mock(ProjectAccessService.class),
                mock(com.hourglass.mapper.MailDeliveryMapper.class),
                mock(NotificationEventService.class), mock(TaskWatchService.class), transactionManager, scopeLock,
                mock(VersionTaskMapper.class));
    }

    private List<Task> expiredTasks(int count, String workspaceId) {
        List<Task> list = new ArrayList<Task>(count);
        for (int i = 1; i <= count; i++) {
            Task t = new Task();
            t.setId("K" + i);
            t.setWorkspaceId(workspaceId);
            t.setDeletedAt(LocalDateTime.now().minusDays(31));
            when(scopeLock.lockTask(workspaceId, t.getId())).thenReturn(t);
            list.add(t);
        }
        return list;
    }

    @Test
    void movingEpicToTrashClearsChildEpicRefs() {
        Task epic = new Task();
        epic.setId("K1");
        epic.setWorkspaceId("W1");
        epic.setTitle("epic");
        when(taskMapper.selectById("K1")).thenReturn(epic);
        when(scopeLock.lockTask("W1", "K1")).thenReturn(epic);

        service.delete("U1", "W1", "K1");

        verify(taskMapper).softDelete("K1");
        verify(taskMapper).clearEpicChildren("W1", "K1");
    }

    @Test
    void purgeExpiredSplitsIntoBatchesOf100() {
        List<Task> expired = expiredTasks(250, "W1");
        when(taskMapper.selectPurgeable(any(LocalDateTime.class), anyInt()))
                .thenReturn(expired).thenReturn(new ArrayList<Task>());

        int purged = service.purgeExpired(LocalDateTime.now());

        assertEquals(250, purged);
        ArgumentCaptor<List<String>> ids = ArgumentCaptor.forClass(List.class);
        verify(subtaskMapper, times(3)).deleteByTaskIds(eq("W1"), ids.capture());
        List<Integer> sizes = new ArrayList<Integer>();
        for (List<String> batch : ids.getAllValues()) {
            sizes.add(batch.size());
        }
        assertEquals(Arrays.asList(100, 100, 50), sizes);
        verify(attachmentService, times(3)).deleteByTasks(eq("W1"), anyList());
        verify(taskMapper, times(3)).deleteByIds(anyList());
        verify(taskMapper, times(3)).clearRecurNextByTaskIds(anyList());
        verify(transactionManager, times(3)).commit(any(TransactionStatus.class));
    }

    @Test
    void failedBatchRollsBackAloneAndOthersContinue() {
        List<Task> expired = expiredTasks(250, "W1");
        when(taskMapper.selectPurgeable(any(LocalDateTime.class), anyInt()))
                .thenReturn(expired).thenReturn(new ArrayList<Task>());
        doThrow(new IllegalStateException("boom")).when(subtaskMapper)
                .deleteByTaskIds(eq("W1"), argThat(batch -> batch != null && batch.contains("K150")));

        int purged = service.purgeExpired(LocalDateTime.now());

        // 第 2 批（K101~K200）失败回滚，第 1、3 批照常提交
        assertEquals(150, purged);
        verify(taskMapper, times(2)).deleteByIds(anyList());
        verify(taskMapper, never()).deleteByIds(argThat(ids -> ids != null && ids.contains("K150")));
        verify(transactionManager, times(1)).rollback(any(TransactionStatus.class));
        verify(transactionManager, times(2)).commit(any(TransactionStatus.class));
    }
}
