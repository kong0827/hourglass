package com.devstudio.kanban.service;

import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.AppNotificationMapper;
import com.devstudio.kanban.mapper.AttachmentMapper;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.GanttShareMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.SubtaskMapper;
import com.devstudio.kanban.mapper.TagMapper;
import com.devstudio.kanban.mapper.TaskBaselineMapper;
import com.devstudio.kanban.mapper.TaskCommentMapper;
import com.devstudio.kanban.mapper.TaskDependencyMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.TimeLogMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
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

    @BeforeEach
    void setUp() {
        taskMapper = mock(TaskMapper.class);
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

        TaskCascade cascade = new TaskCascade(taskMapper, logMapper, commentMapper, notificationMapper, subtaskMapper,
                tagMapper, timeLogMapper, attachmentService, dependencyMapper, baselineMapper,
                mock(GanttShareMapper.class), mock(RequirementMapper.class),
                mock(RequirementDocMapper.class), mock(TaskCompletionService.class),
                mock(DevBranchMapper.class));
        TaskSupport support = new TaskSupport(taskMapper, tagMapper, mock(WorkspaceMetaCache.class));
        service = new TaskTrashService(taskMapper, support, cascade, mock(TimeLogService.class),
                new TaskAuditLogger(logMapper, mock(RequirementMapper.class)), transactionManager);
    }

    private static List<Task> expiredTasks(int count, String workspaceId) {
        List<Task> list = new ArrayList<Task>(count);
        for (int i = 1; i <= count; i++) {
            Task t = new Task();
            t.setId("K" + i);
            t.setWorkspaceId(workspaceId);
            list.add(t);
        }
        return list;
    }

    @Test
    void purgeExpiredSplitsIntoBatchesOf100() {
        when(taskMapper.selectPurgeable(any(LocalDateTime.class))).thenReturn(expiredTasks(250, "W1"));

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
        when(taskMapper.selectPurgeable(any(LocalDateTime.class))).thenReturn(expiredTasks(250, "W1"));
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
