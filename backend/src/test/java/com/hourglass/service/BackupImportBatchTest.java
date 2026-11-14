package com.hourglass.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hourglass.common.AppException;
import com.hourglass.dto.BackupData;
import com.hourglass.entity.Demand;
import com.hourglass.entity.DocumentType;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Requirement;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.Task;
import com.hourglass.entity.TimeLog;
import com.hourglass.mapper.AppNotificationMapper;
import com.hourglass.mapper.BoardColumnMapper;
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
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BackupImportBatchTest {

    private TaskMapper taskMapper;
    private RequirementMapper reqMapper;
    private RequirementDocMapper docMapper;
    private SubtaskMapper subtaskMapper;
    private TimeLogMapper timeLogMapper;
    private TagMapper tagMapper;
    private ProjectVersionMapper versionMapper;
    private VersionTaskMapper versionTaskMapper;
    private DemandMapper demandMapper;
    private PlatformTransactionManager transactionManager;
    private BackupService service;
    private DeliveryScopeLock scopeLock;
    private com.hourglass.mapper.WorkActivityMapper workActivityMapper;

    @BeforeEach
    void setUp() {
        taskMapper = mock(TaskMapper.class);
        scopeLock = mock(DeliveryScopeLock.class);
        reqMapper = mock(RequirementMapper.class);
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
        docMapper = mock(RequirementDocMapper.class);
        when(docMapper.selectAllByWorkspace(anyString())).thenReturn(Collections.emptyList());
        DevBranchMapper branchMapper = mock(DevBranchMapper.class);
        when(branchMapper.selectByWorkspace(anyString(), any())).thenReturn(Collections.emptyList());

        versionMapper = mock(ProjectVersionMapper.class);
        org.mockito.Mockito.doAnswer(invocation -> {
            ProjectVersion version = invocation.getArgument(0);
            when(taskMapper.selectVersionForScope("W1", version.getId())).thenReturn(version);
            return 1;
        }).when(versionMapper).insert(any(ProjectVersion.class));
        versionTaskMapper = mock(VersionTaskMapper.class);
        demandMapper = mock(DemandMapper.class);
        workActivityMapper = mock(com.hourglass.mapper.WorkActivityMapper.class);
        service = new BackupService(taskMapper, reqMapper, subtaskMapper, tagMapper,
                timeLogMapper, columnMapper, categoryMapper, mock(WorkspaceService.class), memberMapper,
                mock(TaskCommentMapper.class),
                mock(com.hourglass.mapper.TestCaseMapper.class),
                mock(com.hourglass.mapper.TestCaseRunMapper.class),
                mock(com.hourglass.mapper.RequirementDocCommentMapper.class),
                mock(AppNotificationMapper.class), docMapper, branchMapper,
                mock(TaskDependencyMapper.class), mock(TaskBaselineMapper.class), mock(GanttShareMapper.class),
                versionMapper, versionTaskMapper, mock(com.hourglass.mapper.VersionCommitmentMapper.class),
                demandMapper, mock(TaskCompletionService.class),
                new TaskCascade(taskMapper, mock(TaskLogMapper.class), mock(TaskCommentMapper.class),
                        mock(com.hourglass.mapper.TaskWatchMapper.class),
                        mock(AppNotificationMapper.class), subtaskMapper, tagMapper, timeLogMapper,
                        mock(AttachmentService.class), mock(TaskDependencyMapper.class),
                        mock(TaskBaselineMapper.class), mock(GanttShareMapper.class),
                        mock(RequirementMapper.class), docMapper,
                        mock(com.hourglass.mapper.RequirementDocHistoryMapper.class),
                        mock(com.hourglass.mapper.RequirementDocCommentMapper.class),
                        mock(TaskCompletionService.class),
                        branchMapper, mock(VersionTaskMapper.class), mock(ProjectVersionMapper.class),
                        mock(DemandMapper.class), mock(com.hourglass.mapper.MailDeliveryMapper.class),
                        mock(com.hourglass.mapper.ReqDocShareMapper.class),
                        mock(com.hourglass.mapper.TestCaseMapper.class),
                        mock(com.hourglass.mapper.TestCaseRunMapper.class),
                        mock(com.hourglass.mapper.DemandDeliveryJudgementMapper.class),
                        mock(com.hourglass.mapper.VersionCommitmentMapper.class),
                        mock(com.hourglass.mapper.ProjectMilestoneMapper.class),
                        mock(com.hourglass.mapper.DeliveryNoteMapper.class), scopeLock),
                mock(ActivityService.class),
                workActivityMapper, transactionManager, scopeLock);
    }

    @ParameterizedTest
    @ValueSource(strings = {"success", "failed", "emptyDraftPlan", "draftPlan", "versionLog", "releaseItem"})
    void overwriteWithAnyDeliveryPlanOrHistoryIsRejectedBeforeAnyDeletion(String history) {
        if ("success".equals(history) || "failed".equals(history)) {
            when(taskMapper.selectReleaseIdsForScope("W1")).thenReturn(Collections.singletonList("VR-" + history));
        } else if (history.endsWith("Plan")) {
            when(taskMapper.selectReleasePlanIdsForScope("W1")).thenReturn(Collections.singletonList("VP1"));
        } else if ("versionLog".equals(history)) {
            when(taskMapper.selectVersionLogIdsForScope("W1")).thenReturn(Collections.singletonList(1L));
        } else {
            when(taskMapper.selectReleaseItemIdsForScope("W1")).thenReturn(Collections.singletonList(1L));
        }
        com.hourglass.common.AppException error = org.junit.jupiter.api.Assertions.assertThrows(
                com.hourglass.common.AppException.class, () -> service.importData("U1", "W1", backup(1)));
        org.junit.jupiter.api.Assertions.assertTrue(error.getMessage().contains("新空间"));
        verify(taskMapper, never()).deleteAllByWorkspace(anyString());
        verify(reqMapper, never()).deleteAllByWorkspace(anyString());
        verify(versionMapper, never()).deleteByWorkspace(anyString());
        verify(workActivityMapper, never()).deleteAllByWorkspace(anyString());
        verify(taskMapper, never()).insertBatch(anyList());
        verify(taskMapper, never()).selectSuccessfulReleaseIdsForScope(anyString());
        verify(transactionManager).rollback(any(TransactionStatus.class));
    }

    @Test
    void emptyWorkspaceCanImportAfterLockedCurrentHistoryChecks() {
        BackupData.ImportResult result = service.importData("U1", "W1", backup(0));

        assertEquals(0, result.getTasks());
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(taskMapper, scopeLock, workActivityMapper);
        order.verify(taskMapper).selectProjectIdsForScope("W1");
        order.verify(scopeLock).lockProjects("W1");
        order.verify(taskMapper).selectReleaseIdsForScope("W1");
        order.verify(taskMapper).selectReleasePlanIdsForScope("W1");
        order.verify(taskMapper).selectReleasePlanTaskIdsForScope("W1");
        order.verify(taskMapper).selectVersionLogIdsForScope("W1");
        order.verify(taskMapper).selectReleaseItemIdsForScope("W1");
        verify(taskMapper, never()).selectTasksForScope(anyString());
        order.verify(workActivityMapper).deleteAllByWorkspace("W1");
        order.verify(taskMapper).deleteAllByWorkspace("W1");
    }

    @Test
    void manualTimestampAloneDoesNotProtectOverwriteOrTransferBadge() {
        Task current = new Task();
        current.setPublishedAt(LocalDate.now());
        current.setPublishSource("manual");
        when(taskMapper.selectTasksForScope("W1")).thenReturn(Collections.singletonList(current));

        assertEquals(1, service.importData("U1", "W1", backup(1)).getTasks());
        verify(taskMapper).deleteAllByWorkspace("W1");
        ArgumentCaptor<List<Task>> imported = ArgumentCaptor.forClass(List.class);
        verify(taskMapper).insertBatch(imported.capture());
        assertNull(imported.getValue().get(0).getPublishedAt());
        assertNull(imported.getValue().get(0).getPublishedReleaseId());
    }

    @Test
    void importCannotAddBindingToReleasedVersion() {
        BackupData data = backup(1);
        BackupData.BackupReq project = new BackupData.BackupReq();
        project.setId("R1");
        project.setName("项目");
        data.setReqs(Collections.singletonList(project));
        BackupData.BackupVersion version = new BackupData.BackupVersion();
        version.setId("V1");
        version.setReqId("R1");
        version.setName("正式首版");
        version.setStatus("released");
        data.setVersions(Collections.singletonList(version));
        data.getTasks().get(0).setReqId("R1");
        data.getTasks().get(0).setVersionIds(Collections.singletonList("V1"));
        org.junit.jupiter.api.Assertions.assertThrows(com.hourglass.common.AppException.class,
                () -> service.importData("U1", "W1", data));
        verify(versionTaskMapper, never()).insertBatch(anyString(), anyString(), anyList());
        verify(taskMapper, never()).insertBatch(anyList());
    }

    @Test
    void missingVersionDictionaryCannotResolveReferencesFromCurrentWorkspace() {
        BackupData data = backup(1);
        data.setVersions(null);
        BackupData.BackupReq project = new BackupData.BackupReq();
        project.setId("R1");
        project.setName("项目");
        data.setReqs(Collections.singletonList(project));
        data.getTasks().get(0).setReqId("R1");
        data.getTasks().get(0).setVersionIds(Collections.singletonList("V1"));
        ProjectVersion retainedVersion = new ProjectVersion();
        retainedVersion.setId("V1");
        retainedVersion.setWorkspaceId("W1");
        retainedVersion.setReqId("R1");
        retainedVersion.setName("保留正式版本");
        retainedVersion.setStatus("released");
        when(taskMapper.selectVersionForScope("W1", "V1")).thenReturn(retainedVersion);

        com.hourglass.common.AppException error = org.junit.jupiter.api.Assertions.assertThrows(
                com.hourglass.common.AppException.class, () -> service.importData("U1", "W1", data));

        org.junit.jupiter.api.Assertions.assertTrue(error.getMessage().contains("字典"));
        verify(transactionManager, never()).getTransaction(any(TransactionDefinition.class));
        verify(versionTaskMapper, never()).insertBatch(anyString(), anyString(), anyList());
        verify(taskMapper, never()).insertBatch(anyList());
    }

    private BackupData backup(int taskCount) {
        BackupData data = new BackupData();
        data.setV(BackupData.FORMAT_VERSION);
        data.setReqs(Collections.emptyList());
        data.setVersions(Collections.emptyList());
        data.setDemands(Collections.emptyList());
        List<BackupData.BackupTask> tasks = new ArrayList<BackupData.BackupTask>();
        for (int i = 1; i <= taskCount; i++) {
            BackupData.BackupTask t = new BackupData.BackupTask();
            t.setId("K" + i);
            t.setTitle("任务" + i);
            t.setVersionIds(Collections.emptyList());
            tasks.add(t);
        }
        data.setTasks(tasks);
        return data;
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 8, 12})
    void oldScalarFormatsAreRejectedBeforeAnyTransaction(int format) {
        BackupData data = backup(1);
        data.setV(format);
        assertEquals(400, org.junit.jupiter.api.Assertions.assertThrows(com.hourglass.common.AppException.class,
                () -> service.importData("U1", "W1", data)).getCode());
        verify(transactionManager, never()).getTransaction(any(TransactionDefinition.class));
        verify(taskMapper, never()).deleteAllByWorkspace(anyString());
    }

    @Test
    void missingVersionArrayIsRejectedInsteadOfSilentlyClearingMembership() {
        BackupData data = backup(1);
        data.getTasks().get(0).setVersionIds(null);
        assertEquals(400, org.junit.jupiter.api.Assertions.assertThrows(com.hourglass.common.AppException.class,
                () -> service.importData("U1", "W1", data)).getCode());
        verify(transactionManager, never()).getTransaction(any(TransactionDefinition.class));
        verify(taskMapper, never()).insertBatch(anyList());
    }

    @Test
    void jsonTransferRestoresBothVersionBindingsWithoutFormalPublicationFields() throws Exception {
        BackupData data = backup(1);
        BackupData.BackupReq project = new BackupData.BackupReq();
        project.setId("R1"); project.setName("项目");
        data.setReqs(Collections.singletonList(project));
        List<BackupData.BackupVersion> versions = new ArrayList<>();
        for (String id : Arrays.asList("V1", "V2")) {
            BackupData.BackupVersion version = new BackupData.BackupVersion();
            version.setId(id); version.setReqId("R1"); version.setName(id); version.setStatus("planned");
            versions.add(version);
        }
        data.setVersions(versions);
        data.getTasks().get(0).setReqId("R1");
        data.getTasks().get(0).setVersionIds(Arrays.asList("V1", "V2"));
        ObjectMapper json = new ObjectMapper();
        String payload = json.writeValueAsString(data);
        JsonNode item = json.readTree(payload).path("tasks").get(0);
        assertTrue(item.path("versionIds").isArray());
        assertFalse(item.has("versionId"));
        assertFalse(item.has("publishedAt"));
        assertFalse(item.has("publishedReleaseId"));
        assertEquals(1, service.importData("U1", "W1", json.readValue(payload, BackupData.class)).getTasks());
        verify(versionTaskMapper).insertBatch("W1", "V1", Collections.singletonList("K1"));
        verify(versionTaskMapper).insertBatch("W1", "V2", Collections.singletonList("K1"));
        verify(versionTaskMapper, never()).deleteByTaskId(anyString(), anyString());
        ArgumentCaptor<List<Task>> imported = ArgumentCaptor.forClass(List.class);
        verify(taskMapper).insertBatch(imported.capture());
        assertNull(imported.getValue().get(0).getPublishedAt());
        assertNull(imported.getValue().get(0).getPublishedReleaseId());
    }

    @ParameterizedTest
    @EnumSource(DocumentType.class)
    void documentClassificationSurvivesExportAndImport(DocumentType type) {
        Requirement project = new Requirement();
        project.setId("R1");
        project.setName("项目");
        when(reqMapper.selectAll("W1")).thenReturn(Collections.singletonList(project));
        RequirementDoc source = new RequirementDoc();
        source.setId("D1");
        source.setWorkspaceId("W1");
        source.setReqId("R1");
        source.setTitle("文档");
        source.setDocType(type.getCode());
        source.setFormat("markdown");
        source.setContent("# 正文");
        source.setPublishedAt(java.time.LocalDateTime.of(2026, 11, 5, 10, 30));
        source.setCreatedAt(java.time.LocalDateTime.of(2026, 11, 1, 9, 0));
        when(docMapper.selectAllByWorkspace("W1")).thenReturn(Collections.singletonList(source));

        BackupData exported = service.export("W1");
        assertEquals(type.getCode(), exported.getReqDocs().get(0).getDocType());
        BackupData.ImportResult result = service.importData("U1", "W1", exported);

        assertEquals(1, result.getReqDocs());
        ArgumentCaptor<RequirementDoc> imported = ArgumentCaptor.forClass(RequirementDoc.class);
        verify(docMapper).insert(imported.capture());
        assertEquals(type.getCode(), imported.getValue().getDocType());
        /* 发布时间随备份往返，导入后不能丢成草稿 */
        assertEquals(source.getPublishedAt(), imported.getValue().getPublishedAt());
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "unknown", "TECHNICAL", "technical-solution"})
    void legacyOrInvalidExternalDocumentClassificationImportsAsOther(String code) {
        BackupData data = backup(0);
        BackupData.BackupReq project = new BackupData.BackupReq();
        project.setId("R1");
        project.setName("项目");
        data.setReqs(Collections.singletonList(project));
        BackupData.BackupReqDoc doc = new BackupData.BackupReqDoc();
        doc.setId("D1");
        doc.setReqId("R1");
        doc.setTitle("旧文档");
        doc.setDocType(code);
        data.setReqDocs(Collections.singletonList(doc));

        BackupData.ImportResult result = service.importData("U1", "W1", data);

        assertEquals(1, result.getReqDocs());
        ArgumentCaptor<RequirementDoc> imported = ArgumentCaptor.forClass(RequirementDoc.class);
        verify(docMapper).insert(imported.capture());
        assertEquals(DocumentType.OTHER.getCode(), imported.getValue().getDocType());
        /* 新格式保留缺省日期，不凭空制造文档发布状态。 */
        assertNull(imported.getValue().getPublishedAt());
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
        // 外层导入事务 + 阶段 1 + 两个任务批；mock 事务管理器不识别 REQUIRED 加入，
        // 真实 DataSourceTransactionManager 下这些 execute 共用同一个提交。
        verify(transactionManager, times(4)).commit(any(TransactionStatus.class));
    }

    @Test
    void importedTasksTakeFreshNumbersInEachProjectBucket() {
        BackupData data = backup(0);
        BackupData.BackupReq p1 = new BackupData.BackupReq();
        p1.setId("R1");
        p1.setName("项目一");
        BackupData.BackupReq p2 = new BackupData.BackupReq();
        p2.setId("R2");
        p2.setName("项目二");
        data.setReqs(Arrays.asList(p1, p2));
        List<BackupData.BackupTask> rows = new ArrayList<BackupData.BackupTask>();
        String[][] pairs = {{"K1", "R1"}, {"K2", "R2"}, {"K3", "R1"}};
        for (String[] pair : pairs) {
            BackupData.BackupTask t = new BackupData.BackupTask();
            t.setId(pair[0]);
            t.setTitle("任务" + pair[0]);
            t.setReqId(pair[1]);
            t.setVersionIds(Collections.emptyList());
            rows.add(t);
        }
        data.setTasks(rows);
        /* 编号不在备份里：目标项目已用到 3 号 / 8 号，导入接着往下取 */
        when(taskMapper.selectNextItemNo("W1", "R1")).thenReturn(4);
        when(taskMapper.selectNextItemNo("W1", "R2")).thenReturn(9);

        service.importData("U1", "W1", data);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Task>> imported = ArgumentCaptor.forClass(List.class);
        verify(taskMapper).insertBatch(imported.capture());
        Map<String, Integer> byId = new HashMap<String, Integer>();
        for (Task t : imported.getValue()) {
            byId.put(t.getId(), t.getItemNo());
        }
        assertEquals(Integer.valueOf(4), byId.get("K1"));
        assertEquals(Integer.valueOf(9), byId.get("K2"));
        assertEquals(Integer.valueOf(5), byId.get("K3"));
    }

    @Test
    void v13RoundTripKeepsVersionArraysEpicAndScalarDemandTarget() {
        Requirement project = new Requirement();
        project.setId("R1");
        project.setWorkspaceId("W1");
        project.setName("项目");
        project.setFirstReleasedAt(LocalDate.of(2026, 5, 10));
        when(reqMapper.selectAll("W1")).thenReturn(Collections.singletonList(project));

        Task epic = new Task();
        epic.setId("T9");
        epic.setTitle("史诗");
        epic.setItemType("epic");
        epic.setReqId("R1");
        Task story = new Task();
        story.setId("T1");
        story.setTitle("故事");
        story.setReqId("R1");
        story.setItemType("story");
        story.setEpicId("T9");
        story.setDemandId("D1");
        when(taskMapper.selectAll("W1")).thenReturn(Arrays.asList(epic, story));

        com.hourglass.dto.TaskVersionBinding binding = new com.hourglass.dto.TaskVersionBinding();
        binding.setTaskId("T1");
        binding.setVersionId("V1");
        when(versionTaskMapper.selectBindingsByWorkspace("W1"))
                .thenReturn(Collections.singletonList(binding));
        ProjectVersion version = new ProjectVersion();
        version.setId("V1");
        version.setWorkspaceId("W1");
        version.setReqId("R1");
        version.setName("V1.0");
        version.setStatus("planned");
        when(versionMapper.selectByWorkspace("W1")).thenReturn(Collections.singletonList(version));
        Demand demand = new Demand();
        demand.setId("D1");
        demand.setWorkspaceId("W1");
        demand.setReqId("R1");
        demand.setTitle("需求");
        demand.setStatus("plan");
        demand.setVersionId("V1");
        when(demandMapper.selectByWorkspace("W1")).thenReturn(Collections.singletonList(demand));

        BackupData exported = service.export("W1");

        assertEquals(13, exported.getV());
        assertEquals("2026-05-10", exported.getReqs().get(0).getFirstReleasedAt());
        BackupData.BackupTask exportedStory = null;
        for (BackupData.BackupTask task : exported.getTasks()) {
            if ("T1".equals(task.getId())) {
                exportedStory = task;
            }
        }
        assertNotNull(exportedStory);
        assertEquals(Collections.singletonList("V1"), exportedStory.getVersionIds());
        assertEquals("D1", exportedStory.getDemandId());
        assertEquals("T9", exportedStory.getEpicId());
        assertEquals(1, exported.getVersions().size());
        assertEquals(1, exported.getDemands().size());

        BackupData.ImportResult result = service.importData("U1", "W1", exported);

        assertEquals(1, result.getVersions());
        assertEquals(1, result.getDemands());
        ArgumentCaptor<ProjectVersion> versionCaptor = ArgumentCaptor.forClass(ProjectVersion.class);
        verify(versionMapper).insert(versionCaptor.capture());
        assertEquals("V1", versionCaptor.getValue().getId());
        assertEquals("R1", versionCaptor.getValue().getReqId());
        assertEquals("planned", versionCaptor.getValue().getStatus());
        ArgumentCaptor<Demand> demandCaptor = ArgumentCaptor.forClass(Demand.class);
        verify(demandMapper).insert(demandCaptor.capture());
        assertEquals("D1", demandCaptor.getValue().getId());
        assertEquals("V1", demandCaptor.getValue().getVersionId());
        verify(versionTaskMapper).insertBatch(eq("W1"), eq("V1"), anyList());
        verify(taskMapper).setEpic("T1", "T9");
    }

    @ParameterizedTest
    @CsvSource(value = {
            "review|2026-12-01|2026-12-10",
            "pass|2026-12-01|2026-12-10",
            "plan|2026-12-01|2026-12-10",
            "rej|2026-12-01|2026-12-10",
            "canceled|2026-12-01|2026-12-10",
            "closed|2026-12-01|2026-12-10",
            "plan|NULL|NULL",
            "plan|2026-12-01|NULL",
            "plan|NULL|2026-12-10",
            "plan|2026-12-01|2026-12-01",
            "canceled|NULL|NULL"
    }, delimiter = '|', nullValues = "NULL")
    void demandDatesAndStatusSurviveJsonRoundTripWithoutChangingTaskEvidence(
            String status, String start, String end) throws Exception {
        Requirement project = new Requirement();
        project.setId("R1");
        project.setName("项目");
        when(reqMapper.selectAll("W1")).thenReturn(Collections.singletonList(project));
        ProjectVersion version = new ProjectVersion();
        version.setId("V1");
        version.setReqId("R1");
        version.setName("目标版本");
        version.setStatus("planned");
        version.setTargetDate(LocalDate.of(2026, 12, 30));
        when(versionMapper.selectByWorkspace("W1")).thenReturn(Collections.singletonList(version));
        Demand source = new Demand();
        source.setId("D1");
        source.setReqId("R1");
        source.setTitle("需求");
        source.setStatus(status);
        if ("closed".equals(status)) {
            source.setCloseReason("dup");
            source.setCloseStage("pass");
        }
        source.setVersionId("V1");
        source.setExpectDate(LocalDate.of(2026, 12, 20));
        source.setPlannedStart(start == null ? null : LocalDate.parse(start));
        source.setPlannedEnd(end == null ? null : LocalDate.parse(end));
        source.setRevision(42L);
        when(demandMapper.selectByWorkspace("W1")).thenReturn(Collections.singletonList(source));
        Task task = new Task();
        task.setId("K1");
        task.setTitle("独立执行任务");
        task.setReqId("R1");
        task.setDemandId("D1");
        task.setBoardColumn("done");
        task.setStartDate(LocalDate.of(2026, 11, 1));
        task.setDueDate(LocalDate.of(2026, 11, 5));
        task.setCompletedAt(LocalDate.of(2026, 11, 5));
        task.setPublishedAt(LocalDate.of(2026, 11, 9));
        task.setPublishSource("version_release");
        task.setPublishedReleaseId("VR-old");
        when(taskMapper.selectAll("W1")).thenReturn(Collections.singletonList(task));

        ObjectMapper json = new ObjectMapper();
        String payload = json.writeValueAsString(service.export("W1"));
        JsonNode tree = json.readTree(payload);
        assertFalse(tree.has("releases"));
        assertFalse(tree.has("releasePlans"));
        assertFalse(tree.path("tasks").get(0).has("publishedAt"));
        assertFalse(tree.path("tasks").get(0).has("publishSource"));
        assertFalse(tree.path("tasks").get(0).has("publishedReleaseId"));
        assertFalse(tree.path("demands").get(0).has("revision"));
        BackupData exported = json.readValue(payload, BackupData.class);
        assertEquals(start, exported.getDemands().get(0).getPlannedStart());
        assertEquals(end, exported.getDemands().get(0).getPlannedEnd());
        assertEquals(status, exported.getDemands().get(0).getStatus());

        BackupData.ImportResult result = service.importData("U1", "W1", exported);

        assertEquals(1, result.getDemands());
        Demand saved = capturedDemand();
        assertEquals("rej".equals(status) || "canceled".equals(status) ? "closed" : status, saved.getStatus());
        if ("rej".equals(status)) {
            assertEquals("rej", saved.getCloseReason());
            assertEquals("review", saved.getCloseStage());
        } else if ("canceled".equals(status)) {
            assertEquals("cancel", saved.getCloseReason());
            assertEquals("plan", saved.getCloseStage());
        } else if ("closed".equals(status)) {
            assertEquals("dup", saved.getCloseReason());
            assertEquals("pass", saved.getCloseStage());
        }
        assertEquals("V1", saved.getVersionId());
        assertEquals(source.getPlannedStart(), saved.getPlannedStart());
        assertEquals(source.getPlannedEnd(), saved.getPlannedEnd());
        assertEquals(source.getExpectDate(), saved.getExpectDate());
        assertEquals(Long.valueOf(0L), saved.getRevision());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Task>> tasks = ArgumentCaptor.forClass(List.class);
        verify(taskMapper).insertBatch(tasks.capture());
        Task savedTask = tasks.getValue().get(0);
        assertEquals(task.getStartDate(), savedTask.getStartDate());
        assertEquals(task.getDueDate(), savedTask.getDueDate());
        assertEquals(task.getCompletedAt(), savedTask.getCompletedAt());
        assertNull(savedTask.getPublishedAt());
        assertNull(savedTask.getPublishSource());
        assertNull(savedTask.getPublishedReleaseId());
        verify(versionTaskMapper, never()).insertBatch(anyString(), anyString(), anyList());
    }

    @ParameterizedTest
    @ValueSource(strings = {"plan", "canceled"})
    void newFormatDemandJsonWithoutPlannedDatesDoesNotInferDates(String status) throws Exception {
        BackupData data = new ObjectMapper().readValue("{\"v\":13,\"tasks\":[],"
                + "\"reqs\":[{\"id\":\"R1\",\"name\":\"项目\"}],"
                + "\"versions\":[{\"id\":\"V1\",\"reqId\":\"R1\",\"name\":\"目标版本\","
                + "\"targetDate\":\"2026-12-30\"}],"
                + "\"demands\":[{\"id\":\"D1\",\"reqId\":\"R1\",\"title\":\"旧需求\","
                + "\"status\":\"" + status + "\",\"versionId\":\"V1\",\"expectDate\":\"2026-12-20\"}]}",
                BackupData.class);
        assertNull(data.getDemands().get(0).getPlannedStart());
        assertNull(data.getDemands().get(0).getPlannedEnd());

        service.importData("U1", "W1", data);

        Demand saved = capturedDemand();
        assertEquals("rej".equals(status) || "canceled".equals(status) ? "closed" : status, saved.getStatus());
        assertEquals("V1", saved.getVersionId());
        assertEquals(LocalDate.of(2026, 12, 20), saved.getExpectDate());
        assertNull(saved.getPlannedStart());
        assertNull(saved.getPlannedEnd());
    }

    @ParameterizedTest
    @ValueSource(strings = {"plan", "canceled"})
    void demandScheduleSurvivesCrossWorkspaceProjectAndVersionIdRemapping(String status) {
        BackupData data = backupWithDemand(status);
        Requirement occupiedProject = new Requirement();
        occupiedProject.setWorkspaceId("W2");
        when(reqMapper.selectById("R1")).thenReturn(occupiedProject);
        ProjectVersion occupiedVersion = new ProjectVersion();
        occupiedVersion.setWorkspaceId("W2");
        when(versionMapper.selectById("V1")).thenReturn(occupiedVersion);
        Demand occupiedDemand = new Demand();
        occupiedDemand.setWorkspaceId("W2");
        when(demandMapper.selectById("D1")).thenReturn(occupiedDemand);

        service.importData("U1", "W1", data);

        ArgumentCaptor<ProjectVersion> versions = ArgumentCaptor.forClass(ProjectVersion.class);
        verify(versionMapper).insert(versions.capture());
        Demand saved = capturedDemand();
        assertNotEquals("D1", saved.getId());
        assertNotEquals("R1", saved.getReqId());
        assertNotEquals("V1", saved.getVersionId());
        assertEquals("W1", saved.getWorkspaceId());
        assertEquals(versions.getValue().getReqId(), saved.getReqId());
        assertEquals(versions.getValue().getId(), saved.getVersionId());
        assertEquals("rej".equals(status) || "canceled".equals(status) ? "closed" : status, saved.getStatus());
        assertEquals(LocalDate.of(2026, 12, 1), saved.getPlannedStart());
        assertEquals(LocalDate.of(2026, 12, 10), saved.getPlannedEnd());
    }

    @ParameterizedTest
    @CsvSource({"plan, missing", "plan, omitted", "plan, unknown", "plan, crossProject", "plan, skipped",
            "canceled, missing", "canceled, omitted", "canceled, unknown", "canceled, crossProject", "canceled, skipped"})
    void invalidDemandTargetRejectsBeforeOverwriteButMissingScalarTargetKeepsDates(String status, String condition) {
        BackupData data = backupWithDemand(status);
        BackupData.BackupDemand demand = data.getDemands().get(0);
        if ("missing".equals(condition)) {
            demand.setVersionId(null);
        } else if ("omitted".equals(condition)) {
            data.setVersions(null);
        } else if ("unknown".equals(condition)) {
            demand.setVersionId("V404");
        } else if ("crossProject".equals(condition)) {
            BackupData.BackupReq otherProject = new BackupData.BackupReq();
            otherProject.setId("R2");
            otherProject.setName("其他项目");
            data.setReqs(Arrays.asList(data.getReqs().get(0), otherProject));
            data.getVersions().get(0).setReqId("R2");
        } else {
            data.getVersions().get(0).setName(" ");
        }

        if ("missing".equals(condition)) {
            service.importData("U1", "W1", data);
            Demand saved = capturedDemand();
            assertNull(saved.getVersionId());
            assertEquals("rej".equals(status) || "canceled".equals(status) ? "closed" : status, saved.getStatus());
            assertEquals(LocalDate.of(2026, 12, 20), saved.getExpectDate());
            assertEquals(LocalDate.of(2026, 12, 1), saved.getPlannedStart());
            assertEquals(LocalDate.of(2026, 12, 10), saved.getPlannedEnd());
        } else {
            assertEquals(400, assertThrows(AppException.class, () -> service.importData("U1", "W1", data)).getCode());
            verify(transactionManager, never()).getTransaction(any(TransactionDefinition.class));
            verify(taskMapper, never()).deleteAllByWorkspace(anyString());
            verify(demandMapper, never()).insert(any(Demand.class));
        }
        verify(taskMapper, never()).insertBatch(anyList());
        verify(versionTaskMapper, never()).insertBatch(anyString(), anyString(), anyList());
    }

    @ParameterizedTest
    @CsvSource(value = {
            "plan|2026-12-10|2026-12-01",
            "canceled|2026-12-10|2026-12-01",
            "plan|not-a-date|2026-12-10",
            "plan|2026-12-01|not-a-date",
            "canceled|2026-02-30|2026-12-10",
            "review|2026-12-01|2026-12-10T12:00:00"
    }, delimiter = '|')
    void invalidDemandDatesAreRejectedBeforeOverwrite(String status, String start, String end) {
        BackupData data = backupWithDemand(status);
        data.getDemands().get(0).setPlannedStart(start);
        data.getDemands().get(0).setPlannedEnd(end);

        AppException error = assertThrows(AppException.class, () -> service.importData("U1", "W1", data));

        assertEquals(400, error.getCode());
        verify(transactionManager, never()).getTransaction(any(TransactionDefinition.class));
        verify(workActivityMapper, never()).deleteAllByWorkspace(anyString());
        verify(taskMapper, never()).deleteAllByWorkspace(anyString());
        verify(reqMapper, never()).insert(any(Requirement.class));
        verify(demandMapper, never()).insert(any(Demand.class));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "unknown", "published", "done", "CANCELED"})
    void unknownDemandStatusStillFallsBackToReview(String status) {
        service.importData("U1", "W1", backupWithDemand(status));

        assertEquals("review", capturedDemand().getStatus());
    }

    private BackupData backupWithDemand(String status) {
        BackupData data = backup(0);
        BackupData.BackupReq project = new BackupData.BackupReq();
        project.setId("R1");
        project.setName("项目");
        data.setReqs(Collections.singletonList(project));
        BackupData.BackupVersion version = new BackupData.BackupVersion();
        version.setId("V1");
        version.setReqId("R1");
        version.setName("目标版本");
        version.setStatus("planned");
        data.setVersions(Collections.singletonList(version));
        BackupData.BackupDemand demand = new BackupData.BackupDemand();
        demand.setId("D1");
        demand.setReqId("R1");
        demand.setTitle("需求");
        demand.setStatus(status);
        demand.setVersionId("V1");
        demand.setExpectDate("2026-12-20");
        demand.setPlannedStart("2026-12-01");
        demand.setPlannedEnd("2026-12-10");
        data.setDemands(Collections.singletonList(demand));
        return data;
    }

    private Demand capturedDemand() {
        ArgumentCaptor<Demand> demand = ArgumentCaptor.forClass(Demand.class);
        verify(demandMapper).insert(demand.capture());
        return demand.getValue();
    }

    @Test
    void manualTimeLogRoundTripKeepsOriginAndNoteAndFallsBackToTimer() {
        BackupData data = backup(1);
        BackupData.BackupTimeLog manual = new BackupData.BackupTimeLog();
        manual.setUserId("U9");
        manual.setStartedAt("2026-11-05T12:00:00");
        manual.setMinutes(75);
        manual.setOrigin("manual");
        manual.setNote("加班联调");
        BackupData.BackupTimeLog legacy = new BackupData.BackupTimeLog();
        legacy.setUserId("U9");
        legacy.setStartedAt("2026-11-04T09:00:00");
        legacy.setMinutes(60);
        data.getTasks().get(0).setTimeLogs(Arrays.asList(manual, legacy));

        service.importData("U1", "W1", data);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<TimeLog>> saved = ArgumentCaptor.forClass(List.class);
        verify(timeLogMapper).insertCompletedBatch(saved.capture());
        List<TimeLog> logs = saved.getValue();
        assertEquals(2, logs.size());
        assertEquals("manual", logs.get(0).getOrigin());
        assertEquals("加班联调", logs.get(0).getNote());
        assertEquals(Integer.valueOf(75), logs.get(0).getMinutes());
        /* 旧备份没有 origin：按计时器回填，避免补记统计口径错乱 */
        assertEquals("timer", logs.get(1).getOrigin());
        assertNull(logs.get(1).getNote());
    }
}
