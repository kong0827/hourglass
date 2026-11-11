package com.hourglass.service;

import com.hourglass.entity.Task;
import com.hourglass.mapper.AppNotificationMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.GanttShareMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.ReqDocShareMapper;
import com.hourglass.mapper.RequirementDocCommentMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TagMapper;
import com.hourglass.mapper.TaskBaselineMapper;
import com.hourglass.mapper.TaskCommentMapper;
import com.hourglass.mapper.TaskDependencyMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TaskWatchMapper;
import com.hourglass.mapper.TestCaseMapper;
import com.hourglass.mapper.TestCaseRunMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.VersionTaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

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
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
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
    private TaskWatchMapper watchMapper;
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
    private RequirementDocCommentMapper docCommentMapper;
    private ReqDocShareMapper reqDocShareMapper;
    private TaskCompletionService completionService;
    private DevBranchMapper devBranchMapper;
    private VersionTaskMapper versionTaskMapper;
    private ProjectVersionMapper versionMapper;
    private DemandMapper demandMapper;
    private TestCaseMapper testCaseMapper;
    private TestCaseRunMapper testCaseRunMapper;
    private TaskCascade cascade;
    private DeliveryScopeLock scopeLock;

    @BeforeEach
    void setUp() {
        taskMapper = mock(TaskMapper.class);
        scopeLock = mock(DeliveryScopeLock.class);
        logMapper = mock(TaskLogMapper.class);
        commentMapper = mock(TaskCommentMapper.class);
        watchMapper = mock(TaskWatchMapper.class);
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
        docCommentMapper = mock(RequirementDocCommentMapper.class);
        reqDocShareMapper = mock(ReqDocShareMapper.class);
        completionService = mock(TaskCompletionService.class);
        devBranchMapper = mock(DevBranchMapper.class);
        versionTaskMapper = mock(VersionTaskMapper.class);
        versionMapper = mock(ProjectVersionMapper.class);
        demandMapper = mock(DemandMapper.class);
        testCaseMapper = mock(TestCaseMapper.class);
        testCaseRunMapper = mock(TestCaseRunMapper.class);
        cascade = new TaskCascade(taskMapper, logMapper, commentMapper, watchMapper, notificationMapper,
                subtaskMapper, tagMapper, timeLogMapper, attachmentService, dependencyMapper,
                baselineMapper, ganttShareMapper, reqMapper, requirementDocMapper,
                mock(com.hourglass.mapper.RequirementDocHistoryMapper.class),
                docCommentMapper, completionService, devBranchMapper, versionTaskMapper, versionMapper, demandMapper,
                mock(com.hourglass.mapper.MailDeliveryMapper.class),
                reqDocShareMapper, testCaseMapper, testCaseRunMapper, scopeLock);
    }

    private List<Task> tasks(String... workspaceAndIds) {
        List<Task> list = new ArrayList<Task>();
        for (int i = 0; i < workspaceAndIds.length; i += 2) {
            Task t = new Task();
            t.setWorkspaceId(workspaceAndIds[i]);
            t.setId(workspaceAndIds[i + 1]);
            t.setDeletedAt(java.time.LocalDateTime.now().minusDays(31));
            when(taskMapper.selectById(t.getId())).thenReturn(t);
            when(scopeLock.lockTask(t.getWorkspaceId(), t.getId())).thenReturn(t);
            list.add(t);
        }
        return list;
    }

    @Test
    void purgeTasksDeletesEveryRegisteredChildTableInOneBatch() {
        List<String> ids = Arrays.asList("K1", "K2");
        tasks(WS, "K1", WS, "K2");

        cascade.purgeTasks(WS, ids);

        verify(taskMapper).clearEpicChildrenByTaskIds(WS, ids);
        verify(subtaskMapper).deleteByTaskIds(WS, ids);
        verify(tagMapper).deleteTaskTagsByTaskIds(WS, ids);
        verify(timeLogMapper).deleteByTaskIds(WS, ids);
        verify(attachmentService).deleteByTasks(WS, ids);
        verify(logMapper).deleteByTaskIds(WS, ids);
        verify(commentMapper).deleteByTaskIds(WS, ids);
        verify(watchMapper).deleteByTaskIds(WS, ids);
        verify(notificationMapper).deleteByTaskIds(WS, ids);
        verify(dependencyMapper).deleteByTaskIds(WS, ids);
        verify(baselineMapper).deleteByTaskIds(WS, ids);
        verify(versionTaskMapper).deleteByTaskIds(WS, ids);
        verify(testCaseMapper).clearBugTaskRefs(WS, ids);
        verify(testCaseRunMapper).clearBugTaskRefs(WS, ids);
        verify(taskMapper).clearRecurNextByTaskIds(ids);
        verify(taskMapper).deleteByIds(ids);
        // BUG-6 A：完成快照不随任务物理删除
        verify(completionService, never()).clearWorkspace(WS);
    }

    @Test
    void purgeRejectsTaskReferencedByReleasePlan() {
        List<String> ids = Arrays.asList("K1");
        Task task = new Task();
        task.setId("K1");
        task.setWorkspaceId(WS);
        when(taskMapper.selectById("K1")).thenReturn(task);
        when(scopeLock.lockTask(WS, "K1")).thenReturn(task);
        when(taskMapper.selectPlanReferencedTaskIds(WS, ids)).thenReturn(Collections.singletonList("K1"));

        org.junit.jupiter.api.Assertions.assertThrows(com.hourglass.common.AppException.class,
                () -> cascade.purgeTasks(WS, ids));

        verify(taskMapper, never()).deleteByIds(ids);
    }

    @Test
    void purgeTasksGroupsByWorkspace() {
        cascade.purgeTasks(tasks("W1", "K1", "W2", "K2", "W1", "K3"));

        verify(subtaskMapper).deleteByTaskIds(eq("W1"), eq(Arrays.asList("K1", "K3")));
        verify(subtaskMapper).deleteByTaskIds(eq("W2"), eq(Collections.singletonList("K2")));
        verify(commentMapper).deleteByTaskIds(eq("W1"), eq(Arrays.asList("K1", "K3")));
        verify(commentMapper).deleteByTaskIds(eq("W2"), eq(Collections.singletonList("K2")));
        verify(testCaseMapper).clearBugTaskRefs(eq("W1"), eq(Arrays.asList("K1", "K3")));
        verify(testCaseMapper).clearBugTaskRefs(eq("W2"), eq(Collections.singletonList("K2")));
        verify(testCaseRunMapper).clearBugTaskRefs(eq("W1"), eq(Arrays.asList("K1", "K3")));
        verify(testCaseRunMapper).clearBugTaskRefs(eq("W2"), eq(Collections.singletonList("K2")));
        verify(taskMapper).deleteByIds(Arrays.asList("K1", "K3"));
        verify(taskMapper).deleteByIds(Collections.singletonList("K2"));
        // 循环派生关联跨空间一次清完
        verify(taskMapper).clearRecurNextByTaskIds(Arrays.asList("K1", "K2", "K3"));
        verify(completionService, never()).clearWorkspace(WS);
    }

    @ParameterizedTest
    @ValueSource(strings = {"success", "failed", "emptyDraftPlan", "draftPlan", "versionLog", "releaseItem"})
    void workspaceWithAnyDeliveryPlanOrHistoryCannotBeWipedOrRebuilt(String history) {
        if ("success".equals(history) || "failed".equals(history)) {
            when(taskMapper.selectReleaseIdsForScope(WS)).thenReturn(Collections.singletonList("VR-" + history));
        } else if (history.endsWith("Plan")) {
            when(taskMapper.selectReleasePlanIdsForScope(WS)).thenReturn(Collections.singletonList("VP1"));
        } else if ("versionLog".equals(history)) {
            when(taskMapper.selectVersionLogIdsForScope(WS)).thenReturn(Collections.singletonList(1L));
        } else {
            when(taskMapper.selectReleaseItemIdsForScope(WS)).thenReturn(Collections.singletonList(1L));
        }
        com.hourglass.common.AppException error = org.junit.jupiter.api.Assertions.assertThrows(
                com.hourglass.common.AppException.class, () -> cascade.wipeWorkspaceData(WS));
        assertTrue(error.getMessage().contains("导入新空间"));
        org.junit.jupiter.api.Assertions.assertThrows(com.hourglass.common.AppException.class,
                () -> cascade.clearWorkspaceDataForImport(WS, true, true, true, true, true, true));
        org.junit.jupiter.api.Assertions.assertThrows(com.hourglass.common.AppException.class,
                () -> cascade.purgeWorkspaceTaskData(WS, true, true));
        verify(taskMapper, never()).deleteAllByWorkspace(WS);
        verify(reqMapper, never()).deleteAllByWorkspace(WS);
        verify(versionMapper, never()).deleteByWorkspace(WS);
        verify(logMapper, never()).deleteAllByWorkspace(WS);
        verify(testCaseMapper, never()).deletePlansByWorkspace(WS);
        org.mockito.Mockito.verifyNoInteractions(attachmentService, completionService);
        verify(taskMapper, never()).selectSuccessfulReleaseIdsForScope(WS);
    }

    @Test
    void workspaceGuardUsesCurrentProjectListAndReadsHistoryAfterProjectMutex() {
        when(taskMapper.selectProjectIdsForScope(WS)).thenReturn(Arrays.asList("R1", "R2"));
        org.mockito.Mockito.doAnswer(invocation -> {
            when(taskMapper.selectReleaseIdsForScope(WS)).thenReturn(Collections.singletonList("VR-failed"));
            return null;
        }).when(scopeLock).lockProjects(WS, "R1", "R2");

        org.junit.jupiter.api.Assertions.assertThrows(com.hourglass.common.AppException.class,
                () -> cascade.wipeWorkspaceData(WS));

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(taskMapper, scopeLock);
        order.verify(taskMapper).selectProjectIdsForScope(WS);
        order.verify(scopeLock).lockProjects(WS, "R1", "R2");
        order.verify(taskMapper).selectReleaseIdsForScope(WS);
        verify(reqMapper, never()).selectAll(WS);
        verify(logMapper, never()).deleteAllByWorkspace(WS);
    }

    @Test
    void rebuildGuardQueriesAreCurrentWorkspaceReadsWithoutSuccessOrDraftFilters() throws Exception {
        org.apache.ibatis.session.Configuration cfg = new org.apache.ibatis.session.Configuration();
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.dto");
        String resource = "mapper/TaskMapper.xml";
        try (java.io.InputStream stream = getClass().getClassLoader().getResourceAsStream(resource)) {
            org.junit.jupiter.api.Assertions.assertNotNull(stream);
            new org.apache.ibatis.builder.xml.XMLMapperBuilder(stream, cfg, resource, cfg.getSqlFragments()).parse();
        }
        for (String statement : new String[] {"selectProjectIdsForScope", "selectTasksByDemandForScope",
                "selectReleaseIdsForScope", "selectReleasePlanIdsForScope", "selectVersionLogIdsForScope",
                "selectReleaseItemIdsForScope"}) {
            String sql = cfg.getMappedStatement("com.hourglass.mapper.TaskMapper." + statement)
                    .getBoundSql(Collections.emptyMap()).getSql().replaceAll("\\s+", " ");
            assertTrue(sql.contains("workspace_id = ?"), statement);
            assertTrue(sql.contains("ORDER BY id FOR UPDATE"), statement);
            org.junit.jupiter.api.Assertions.assertFalse(sql.contains("result ="), statement);
            org.junit.jupiter.api.Assertions.assertFalse(sql.contains("status ="), statement);
            if ("selectTasksByDemandForScope".equals(statement)) {
                assertTrue(sql.contains("demand_id = ?"));
                org.junit.jupiter.api.Assertions.assertFalse(sql.contains("deleted_at IS NULL"));
                org.junit.jupiter.api.Assertions.assertFalse(sql.contains("published_at"), "冻结依据正式记录而非任务人工时间戳");
            }
        }
    }

    @Test
    void crossWorkspacePurgeLocksEveryProjectBeforeTasksInGlobalIdOrder() {
        List<Task> batch = tasks("W1", "K3", "W2", "K1", "W1", "K2");
        batch.get(0).setReqId("R3");
        batch.get(1).setReqId("R1");
        batch.get(2).setReqId("R2");

        cascade.purgeTasks(batch);

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(scopeLock, taskMapper);
        order.verify(scopeLock).lockProjects("W2", "R1");
        order.verify(scopeLock).lockProjects("W1", "R2");
        order.verify(scopeLock).lockProjects("W1", "R3");
        order.verify(scopeLock).lockTask("W2", "K1");
        order.verify(scopeLock).lockTask("W1", "K2");
        order.verify(scopeLock).lockTask("W1", "K3");
        order.verify(taskMapper).clearRecurNextByTaskIds(Arrays.asList("K3", "K1", "K2"));
        org.mockito.Mockito.verifyNoMoreInteractions(scopeLock);
    }

    @Test
    void manualTimestampAloneDoesNotProtectWorkspaceWipeOrImportReplacement() {
        Task current = new Task();
        current.setPublishedAt(java.time.LocalDate.now());
        current.setPublishSource("manual");
        when(taskMapper.selectTasksForScope(WS)).thenReturn(Collections.singletonList(current));

        cascade.wipeWorkspaceData(WS);
        cascade.clearWorkspaceDataForImport(WS, true, true, true, true, true, true);
        verify(taskMapper, org.mockito.Mockito.times(2)).deleteAllByWorkspace(WS);
        verify(reqMapper, org.mockito.Mockito.times(2)).deleteAllByWorkspace(WS);
        verify(versionMapper, org.mockito.Mockito.times(2)).deleteByWorkspace(WS);
        /* 测试计划/模块不在备份里：只有整空间删除清理，导入覆盖保留 */
        verify(testCaseMapper).deletePlanCasesByWorkspace(WS);
        verify(testCaseMapper).deletePlansByWorkspace(WS);
        verify(testCaseMapper).deleteModulesByWorkspace(WS);
    }

    @Test
    void purgeUsesLockedStateAndCannotDeleteConcurrentlyRestoredTask() {
        tasks(WS, "K1");
        Task current = new Task();
        when(scopeLock.lockTask(WS, "K1")).thenReturn(current);
        org.junit.jupiter.api.Assertions.assertThrows(com.hourglass.common.AppException.class,
                () -> cascade.purgeTasks(WS, Collections.singletonList("K1")));
        verify(taskMapper, never()).deleteByIds(anyList());
    }

    @Test
    void successfulVersionMembershipRatherThanManualTimestampProtectsPurge() {
        List<Task> batch = tasks(WS, "K1");
        when(taskMapper.selectTaskVersionsForScope(WS, "K1")).thenReturn(Collections.singletonList("V1"));
        when(taskMapper.selectVersionSuccessIdsForScope(WS, "V1")).thenReturn(Collections.singletonList("VR1"));
        org.junit.jupiter.api.Assertions.assertThrows(com.hourglass.common.AppException.class,
                () -> cascade.purgeTasks(batch));
        verify(taskMapper, never()).deleteByIds(anyList());
        verify(logMapper, never()).deleteByTaskIds(eq(WS), anyList());
    }

    @Test
    void wipeClearsEveryRegisteredWorkspaceTable() {
        cascade.wipeWorkspaceData(WS);

        verify(logMapper).deleteAllByWorkspace(WS);
        verify(dependencyMapper).deleteByWorkspace(WS);
        verify(baselineMapper).deleteByWorkspace(WS);
        verify(ganttShareMapper).deleteByWorkspace(WS);
        verify(taskMapper).deleteAllByWorkspace(WS);
        verify(testCaseRunMapper).deleteByWorkspace(WS);
        verify(testCaseMapper).deleteByWorkspace(WS);
        verify(testCaseRunMapper).clearAllBugTaskRefs(WS);
        verify(testCaseMapper).clearAllBugTaskRefs(WS);
        verify(reqMapper).deleteAllByWorkspace(WS);
        verify(requirementDocMapper).deleteAllByWorkspace(WS);
        verify(docCommentMapper).deleteByWorkspace(WS);
        verify(reqDocShareMapper).deleteByWorkspace(WS);
        verify(completionService).clearWorkspace(WS);
        verify(subtaskMapper).deleteAllByWorkspace(WS);
        verify(tagMapper).deleteAllTaskTagsByWorkspace(WS);
        verify(tagMapper).deleteTagsByWorkspace(WS);
        verify(timeLogMapper).deleteAllByWorkspace(WS);
        verify(attachmentService).deleteAllWithFiles(WS);
        verify(commentMapper).deleteAllByWorkspace(WS);
        verify(watchMapper).deleteAllByWorkspace(WS);
        verify(notificationMapper).deleteAllByWorkspace(WS);
        verify(devBranchMapper).deleteLogsByWorkspace(WS);
        verify(devBranchMapper).deleteByWorkspace(WS);
        verify(versionTaskMapper).deleteByWorkspace(WS);
        verify(versionMapper).deleteByWorkspace(WS);
        verify(demandMapper).deleteLogsByWorkspace(WS);
        verify(demandMapper).deleteByWorkspace(WS);
    }

    @Test
    void importClearingKeepsAuditLogsAttachmentsAndOptionalData() {
        cascade.clearWorkspaceDataForImport(WS, false, false, false, false, false, false);

        verify(taskMapper).deleteAllByWorkspace(WS);
        verify(testCaseRunMapper, never()).deleteByWorkspace(WS);
        verify(testCaseMapper, never()).deleteByWorkspace(WS);
        verify(testCaseRunMapper).clearAllBugTaskRefs(WS);
        verify(testCaseMapper).clearAllBugTaskRefs(WS);
        verify(docCommentMapper, never()).deleteByWorkspace(WS);
        verify(completionService).clearWorkspace(WS);
        verify(commentMapper).deleteAllByWorkspace(WS);
        verify(watchMapper).deleteAllByWorkspace(WS);
        verify(notificationMapper).deleteAllByWorkspace(WS);
        verify(logMapper, never()).deleteAllByWorkspace(WS);
        verify(attachmentService, never()).deleteAllWithFiles(WS);
        verify(requirementDocMapper, never()).deleteAllByWorkspace(WS);
        verify(devBranchMapper, never()).deleteByWorkspace(WS);
        verify(versionMapper, never()).deleteByWorkspace(WS);
        verify(demandMapper, never()).deleteByWorkspace(WS);

        cascade.clearWorkspaceDataForImport(WS, true, true, true, true, true, true);

        verify(requirementDocMapper).deleteAllByWorkspace(WS);
        verify(testCaseRunMapper).deleteByWorkspace(WS);
        verify(testCaseMapper).deleteByWorkspace(WS);
        verify(docCommentMapper).deleteByWorkspace(WS);
        verify(reqDocShareMapper).deleteByWorkspace(WS);
        verify(devBranchMapper).deleteLogsByWorkspace(WS);
        verify(devBranchMapper).deleteByWorkspace(WS);
        verify(versionMapper).deleteByWorkspace(WS);
        /* 需求流转日志不在备份里，导入时必须保留 */
        verify(demandMapper, never()).deleteLogsByWorkspace(WS);
        verify(demandMapper).deleteByWorkspace(WS);
    }

    @Test
    void registeredChildTablesMatchSnapshot() {
        assertEquals(Arrays.asList(
                "task_log", "task_comment", "task_watch", "app_notification", "subtask", "task_tag",
                "attachment", "time_log", "task_dependency", "task_baseline", "version_task"),
                TaskCascade.TASK_CHILD_TABLES);
        assertEquals(Arrays.asList("task_completion_record", "version_release_item", "version_release_plan_task"),
                TaskCascade.PRESERVED_TASK_REF_TABLES);
        assertEquals(Arrays.asList("version_release", "version_release_item", "version_release_plan", "version_release_plan_version", "version_release_plan_task", "version_log"),
                TaskCascade.PRESERVED_WORKSPACE_DELIVERY_TABLES);
        for (String table : TaskCascade.PRESERVED_WORKSPACE_DELIVERY_TABLES) {
            org.junit.jupiter.api.Assertions.assertFalse(TaskCascade.WORKSPACE_TASK_TABLES.contains(table), table);
        }

        List<String> ref = new ArrayList<String>(TaskCascade.TASK_CHILD_TABLES);
        ref.addAll(TaskCascade.PRESERVED_TASK_REF_TABLES);
        assertEquals(ref, TaskCascade.TASK_REF_TABLES);

        assertEquals(Arrays.asList(
                "task_log", "task_dependency", "task_baseline", "gantt_share", "task",
                "test_case_run", "test_case",
                "requirement", "requirement_doc", "req_doc_share", "task_completion_record", "subtask",
                "task_tag", "tag", "time_log", "attachment", "task_comment", "task_watch",
                "app_notification", "dev_branch_log", "dev_branch",
                "version_task", "project_version", "demand_log", "demand"),
                TaskCascade.WORKSPACE_TASK_TABLES);
    }

    /** 后端独立快照不携带仓库 SQL；离线验证 Mapper 中任务引用清理的登记覆盖。 */
    @Test
    void everyTaskReferenceMutationInMappersIsRegistered() throws Exception {
        Path mapperDir = Paths.get(getClass().getClassLoader().getResource("mapper").toURI());
        Set<String> mentioned = new TreeSet<String>();
        Set<String> mutated = new TreeSet<String>();
        Pattern table = Pattern.compile("(?i)\\b(?:FROM|JOIN|INTO|UPDATE)\\s+([a-z0-9_]+)\\b");
        Pattern mutation = Pattern.compile("(?is)\\b(?:DELETE\\s+FROM|UPDATE)\\s+([a-z0-9_]+)\\b(.*)");
        Pattern taskColumn = Pattern.compile("(?i)\\b(?:from_|to_|ref_)?task_id\\b");
        Pattern statement = Pattern.compile("(?is)<(?:select|insert|update|delete)\\b[^>]*>(.*?)</(?:select|insert|update|delete)>");
        try (DirectoryStream<Path> files = Files.newDirectoryStream(mapperDir, "*.xml")) {
            for (Path file : files) {
                String xml = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
                Matcher references = table.matcher(xml);
                while (references.find()) mentioned.add(references.group(1).toLowerCase(java.util.Locale.ROOT));
                Matcher statements = statement.matcher(xml);
                while (statements.find()) {
                    Matcher changes = mutation.matcher(statements.group(1));
                    if (changes.find() && taskColumn.matcher(changes.group(2)).find()) mutated.add(changes.group(1));
                }
            }
        }
        assertTrue(!mutated.isEmpty(), "必须扫描到真实任务引用清理语句");
        for (String registered : TaskCascade.TASK_REF_TABLES) {
            assertTrue(mentioned.contains(registered), "登记表缺少 Mapper SQL 覆盖：" + registered);
        }
        for (String preserved : TaskCascade.PRESERVED_WORKSPACE_DELIVERY_TABLES) {
            assertTrue(mentioned.contains(preserved), "正式历史保留表缺少 Mapper SQL 覆盖：" + preserved);
        }
        mutated.remove("task");
        mutated.removeAll(TaskCascade.TASK_REF_TABLES);
        assertTrue(mutated.isEmpty(), "任务引用清理表必须登记：" + mutated);
    }
}
