package com.devstudio.kanban.service;

import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.AppNotificationMapper;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SuppressWarnings("unchecked")
class TaskCascadeTest {

    private static final String WS = "W1";

    private TaskMapper taskMapper;
    private TaskLogMapper logMapper;
    private TaskCommentMapper commentMapper;
    private AppNotificationMapper notificationMapper;
    private SubtaskMapper subtaskMapper;
    private TagMapper tagMapper;
    private TimeLogMapper timeLogMapper;
    private AttachmentService attachmentService;
    private TaskDependencyMapper dependencyMapper;
    private TaskBaselineMapper baselineMapper;
    private GanttShareMapper ganttShareMapper;
    private RequirementMapper reqMapper;
    private RequirementDocMapper requirementDocMapper;
    private TaskCompletionService completionService;
    private DevBranchMapper devBranchMapper;
    private TaskCascade cascade;

    @BeforeEach
    void setUp() {
        taskMapper = mock(TaskMapper.class);
        logMapper = mock(TaskLogMapper.class);
        commentMapper = mock(TaskCommentMapper.class);
        notificationMapper = mock(AppNotificationMapper.class);
        subtaskMapper = mock(SubtaskMapper.class);
        tagMapper = mock(TagMapper.class);
        timeLogMapper = mock(TimeLogMapper.class);
        attachmentService = mock(AttachmentService.class);
        dependencyMapper = mock(TaskDependencyMapper.class);
        baselineMapper = mock(TaskBaselineMapper.class);
        ganttShareMapper = mock(GanttShareMapper.class);
        reqMapper = mock(RequirementMapper.class);
        requirementDocMapper = mock(RequirementDocMapper.class);
        completionService = mock(TaskCompletionService.class);
        devBranchMapper = mock(DevBranchMapper.class);
        cascade = new TaskCascade(taskMapper, logMapper, commentMapper, notificationMapper,
                subtaskMapper, tagMapper, timeLogMapper, attachmentService, dependencyMapper,
                baselineMapper, ganttShareMapper, reqMapper, requirementDocMapper,
                completionService, devBranchMapper);
    }

    private static List<Task> tasks(String... workspaceAndIds) {
        List<Task> list = new ArrayList<Task>();
        for (int i = 0; i < workspaceAndIds.length; i += 2) {
            Task t = new Task();
            t.setWorkspaceId(workspaceAndIds[i]);
            t.setId(workspaceAndIds[i + 1]);
            list.add(t);
        }
        return list;
    }

    @Test
    void purgeTasksDeletesEveryRegisteredChildTableInOneBatch() {
        List<String> ids = Arrays.asList("K1", "K2");

        cascade.purgeTasks(WS, ids);

        verify(subtaskMapper).deleteByTaskIds(WS, ids);
        verify(tagMapper).deleteTaskTagsByTaskIds(WS, ids);
        verify(timeLogMapper).deleteByTaskIds(WS, ids);
        verify(attachmentService).deleteByTasks(WS, ids);
        verify(logMapper).deleteByTaskIds(WS, ids);
        verify(commentMapper).deleteByTaskIds(WS, ids);
        verify(notificationMapper).deleteByTaskIds(WS, ids);
        verify(dependencyMapper).deleteByTaskIds(WS, ids);
        verify(baselineMapper).deleteByTaskIds(WS, ids);
        verify(taskMapper).clearRecurNextByTaskIds(ids);
        verify(taskMapper).deleteByIds(ids);
        // BUG-6 A：完成快照不随任务物理删除
        verify(completionService, never()).clearWorkspace(WS);
    }

    @Test
    void purgeTasksGroupsByWorkspace() {
        cascade.purgeTasks(tasks("W1", "K1", "W2", "K2", "W1", "K3"));

        verify(subtaskMapper).deleteByTaskIds(eq("W1"), eq(Arrays.asList("K1", "K3")));
        verify(subtaskMapper).deleteByTaskIds(eq("W2"), eq(Collections.singletonList("K2")));
        verify(commentMapper).deleteByTaskIds(eq("W1"), eq(Arrays.asList("K1", "K3")));
        verify(commentMapper).deleteByTaskIds(eq("W2"), eq(Collections.singletonList("K2")));
        verify(taskMapper).deleteByIds(Arrays.asList("K1", "K3"));
        verify(taskMapper).deleteByIds(Collections.singletonList("K2"));
        // 循环派生关联跨空间一次清完
        verify(taskMapper).clearRecurNextByTaskIds(Arrays.asList("K1", "K2", "K3"));
        verify(completionService, never()).clearWorkspace(WS);
    }

    @Test
    void wipeClearsEveryRegisteredWorkspaceTable() {
        cascade.wipeWorkspaceData(WS);

        verify(logMapper).deleteAllByWorkspace(WS);
        verify(dependencyMapper).deleteByWorkspace(WS);
        verify(baselineMapper).deleteByWorkspace(WS);
        verify(ganttShareMapper).deleteByWorkspace(WS);
        verify(taskMapper).deleteAllByWorkspace(WS);
        verify(reqMapper).deleteAllByWorkspace(WS);
        verify(requirementDocMapper).deleteAllByWorkspace(WS);
        verify(completionService).clearWorkspace(WS);
        verify(subtaskMapper).deleteAllByWorkspace(WS);
        verify(tagMapper).deleteAllTaskTagsByWorkspace(WS);
        verify(tagMapper).deleteTagsByWorkspace(WS);
        verify(timeLogMapper).deleteAllByWorkspace(WS);
        verify(attachmentService).deleteAllWithFiles(WS);
        verify(commentMapper).deleteAllByWorkspace(WS);
        verify(notificationMapper).deleteAllByWorkspace(WS);
        verify(devBranchMapper).deleteLogsByWorkspace(WS);
        verify(devBranchMapper).deleteByWorkspace(WS);
    }

    @Test
    void importClearingKeepsAuditLogsAttachmentsAndOptionalData() {
        cascade.clearWorkspaceDataForImport(WS, false, false);

        verify(taskMapper).deleteAllByWorkspace(WS);
        verify(completionService).clearWorkspace(WS);
        verify(commentMapper).deleteAllByWorkspace(WS);
        verify(notificationMapper).deleteAllByWorkspace(WS);
        verify(logMapper, never()).deleteAllByWorkspace(WS);
        verify(attachmentService, never()).deleteAllWithFiles(WS);
        verify(requirementDocMapper, never()).deleteAllByWorkspace(WS);
        verify(devBranchMapper, never()).deleteByWorkspace(WS);

        cascade.clearWorkspaceDataForImport(WS, true, true);

        verify(requirementDocMapper).deleteAllByWorkspace(WS);
        verify(devBranchMapper).deleteLogsByWorkspace(WS);
        verify(devBranchMapper).deleteByWorkspace(WS);
    }

    @Test
    void registeredChildTablesMatchSnapshot() {
        assertEquals(Arrays.asList(
                "task_log", "task_comment", "app_notification", "subtask", "task_tag",
                "attachment", "time_log", "task_dependency", "task_baseline"),
                TaskCascade.TASK_CHILD_TABLES);
        assertEquals(Collections.singletonList("task_completion_record"),
                TaskCascade.PRESERVED_TASK_REF_TABLES);

        List<String> ref = new ArrayList<String>(TaskCascade.TASK_CHILD_TABLES);
        ref.addAll(TaskCascade.PRESERVED_TASK_REF_TABLES);
        assertEquals(ref, TaskCascade.TASK_REF_TABLES);

        assertEquals(Arrays.asList(
                "task_log", "task_dependency", "task_baseline", "gantt_share", "task",
                "requirement", "requirement_doc", "task_completion_record", "subtask",
                "task_tag", "tag", "time_log", "attachment", "task_comment",
                "app_notification", "dev_branch_log", "dev_branch"),
                TaskCascade.WORKSPACE_TASK_TABLES);
    }

    /** 离线扫描 sql/ 的建表语句：新增带 task_id 的表却忘了登记时，这里会失败 */
    @Test
    void everyTableWithTaskColumnInSqlIsRegistered() throws IOException {
        Path sqlDir = Paths.get("sql");
        assertTrue(Files.isDirectory(sqlDir), "找不到 sql/ 目录：" + sqlDir.toAbsolutePath());

        Set<String> found = new TreeSet<String>();
        Pattern createTable = Pattern.compile(
                "(?is)CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?`?([a-z0-9_]+)`?\\s*\\((.*?)\\)\\s*ENGINE");
        Pattern taskColumn = Pattern.compile("(?im)^\\s*(?:from_|to_|ref_)?task_id\\s");

        DirectoryStream<Path> files = Files.newDirectoryStream(sqlDir, "*.sql");
        try {
            for (Path file : files) {
                String sql = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
                Matcher m = createTable.matcher(sql);
                while (m.find()) {
                    if (taskColumn.matcher(m.group(2)).find()) {
                        found.add(m.group(1));
                    }
                }
            }
        } finally {
            files.close();
        }

        assertEquals(new TreeSet<String>(TaskCascade.TASK_REF_TABLES), found,
                "sql/ 中带 task_id 的表必须登记到 TaskCascade.TASK_REF_TABLES");
    }
}
