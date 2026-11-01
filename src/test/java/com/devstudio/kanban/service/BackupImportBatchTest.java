package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.BackupData;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.AppNotificationMapper;
import com.devstudio.kanban.mapper.BoardColumnMapper;
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
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BackupImportBatchTest {

    private TaskMapper taskMapper;
    private SubtaskMapper subtaskMapper;
    private TimeLogMapper timeLogMapper;
    private TagMapper tagMapper;
    private PlatformTransactionManager transactionManager;
    private BackupService service;

    @BeforeEach
    void setUp() {
        taskMapper = mock(TaskMapper.class);
        subtaskMapper = mock(SubtaskMapper.class);
        timeLogMapper = mock(TimeLogMapper.class);
        tagMapper = mock(TagMapper.class);
        transactionManager = mock(PlatformTransactionManager.class);
        when(transactionManager.getTransaction(any(TransactionDefinition.class)))
                .thenReturn(new SimpleTransactionStatus());

        WorkspaceMemberMapper memberMapper = mock(WorkspaceMemberMapper.class);
        when(memberMapper.selectUserIds(anyString())).thenReturn(Collections.<String>emptyList());
        when(taskMapper.selectIdsInOtherWorkspaces(anyString(), anyList()))
                .thenReturn(Collections.<String>emptyList());
        CategoryMapper categoryMapper = mock(CategoryMapper.class);
        when(categoryMapper.selectByWorkspace(anyString())).thenReturn(Collections.emptyList());
        BoardColumnMapper columnMapper = mock(BoardColumnMapper.class);
        when(columnMapper.selectAll(anyString())).thenReturn(Collections.emptyList());
        when(tagMapper.selectAllByWorkspace(anyString())).thenReturn(Collections.emptyList());
        RequirementDocMapper docMapper = mock(RequirementDocMapper.class);
        when(docMapper.selectAllByWorkspace(anyString())).thenReturn(Collections.emptyList());
        DevBranchMapper branchMapper = mock(DevBranchMapper.class);
        when(branchMapper.selectByWorkspace(anyString())).thenReturn(Collections.emptyList());

        service = new BackupService(taskMapper, mock(RequirementMapper.class), subtaskMapper, tagMapper,
                timeLogMapper, columnMapper, categoryMapper, mock(WorkspaceService.class), memberMapper,
                mock(TaskCommentMapper.class), mock(AppNotificationMapper.class), docMapper, branchMapper,
                mock(TaskDependencyMapper.class), mock(TaskBaselineMapper.class), mock(GanttShareMapper.class),
                mock(TaskCompletionService.class),
                new TaskCascade(taskMapper, mock(TaskLogMapper.class), mock(TaskCommentMapper.class),
                        mock(AppNotificationMapper.class), subtaskMapper, tagMapper, timeLogMapper,
                        mock(AttachmentService.class), mock(TaskDependencyMapper.class),
                        mock(TaskBaselineMapper.class), mock(GanttShareMapper.class),
                        mock(RequirementMapper.class), docMapper, mock(TaskCompletionService.class),
                        branchMapper),
                mock(ActivityService.class),
                transactionManager);
    }

    private BackupData backup(int taskCount) {
        BackupData data = new BackupData();
        List<BackupData.BackupTask> tasks = new ArrayList<BackupData.BackupTask>();
        for (int i = 1; i <= taskCount; i++) {
            BackupData.BackupTask t = new BackupData.BackupTask();
            t.setId("K" + i);
            t.setTitle("任务" + i);
            tasks.add(t);
        }
        data.setTasks(tasks);
        return data;
    }

    @Test
    void importsTasksInBatchesOf500() {
        BackupData.ImportResult result = service.importData("U1", "W1", backup(501));

        assertEquals(501, result.getTasks());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Task>> batches = ArgumentCaptor.forClass(List.class);
        verify(taskMapper, times(2)).insertBatch(batches.capture());
        assertEquals(500, batches.getAllValues().get(0).size());
        assertEquals(1, batches.getAllValues().get(1).size());
        verify(taskMapper, never()).insert(any(Task.class));
        // 阶段 1 + 两个任务批（没有依赖/基线/评论时阶段 3、4 不开启事务）
        verify(transactionManager, times(3)).commit(any(TransactionStatus.class));
    }
}
