package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.BackupData;
import com.devstudio.kanban.entity.Demand;
import com.devstudio.kanban.entity.DocumentType;
import com.devstudio.kanban.entity.ProjectVersion;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.AppNotificationMapper;
import com.devstudio.kanban.mapper.BoardColumnMapper;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.DevBranchMapper;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.ProjectVersionMapper;
import com.devstudio.kanban.mapper.VersionTaskMapper;
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
import org.junit.jupiter.params.ParameterizedTest;
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
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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

    @BeforeEach
    void setUp() {
        taskMapper = mock(TaskMapper.class);
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
        versionTaskMapper = mock(VersionTaskMapper.class);
        demandMapper = mock(DemandMapper.class);
        service = new BackupService(taskMapper, reqMapper, subtaskMapper, tagMapper,
                timeLogMapper, columnMapper, categoryMapper, mock(WorkspaceService.class), memberMapper,
                mock(TaskCommentMapper.class), mock(AppNotificationMapper.class), docMapper, branchMapper,
                mock(TaskDependencyMapper.class), mock(TaskBaselineMapper.class), mock(GanttShareMapper.class),
                versionMapper, versionTaskMapper, demandMapper,
                mock(TaskCompletionService.class),
                new TaskCascade(taskMapper, mock(TaskLogMapper.class), mock(TaskCommentMapper.class),
                        mock(AppNotificationMapper.class), subtaskMapper, tagMapper, timeLogMapper,
                        mock(AttachmentService.class), mock(TaskDependencyMapper.class),
                        mock(TaskBaselineMapper.class), mock(GanttShareMapper.class),
                        mock(RequirementMapper.class), docMapper, mock(TaskCompletionService.class),
                        branchMapper, mock(VersionTaskMapper.class), mock(ProjectVersionMapper.class),
                        mock(DemandMapper.class)),
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
        when(docMapper.selectAllByWorkspace("W1")).thenReturn(Collections.singletonList(source));

        BackupData exported = service.export("W1");
        assertEquals(type.getCode(), exported.getReqDocs().get(0).getDocType());
        BackupData.ImportResult result = service.importData("U1", "W1", exported);

        assertEquals(1, result.getReqDocs());
        ArgumentCaptor<RequirementDoc> imported = ArgumentCaptor.forClass(RequirementDoc.class);
        verify(docMapper).insert(imported.capture());
        assertEquals(type.getCode(), imported.getValue().getDocType());
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

    @Test
    void v8RoundTripKeepsVersionsTaskBindingsEpicAndDemandPool() {
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
        Task story = new Task();
        story.setId("T1");
        story.setTitle("故事");
        story.setReqId("R1");
        story.setItemType("story");
        story.setEpicId("T9");
        story.setDemandId("D1");
        when(taskMapper.selectAll("W1")).thenReturn(Arrays.asList(epic, story));

        Task binding = new Task();
        binding.setId("T1");
        binding.setVersionId("V1");
        when(versionTaskMapper.selectBindingsByWorkspace("W1"))
                .thenReturn(Collections.singletonList(binding));
        ProjectVersion version = new ProjectVersion();
        version.setId("V1");
        version.setWorkspaceId("W1");
        version.setReqId("R1");
        version.setName("V1.0");
        version.setStatus("released");
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

        assertEquals(8, exported.getV());
        assertEquals("2026-05-10", exported.getReqs().get(0).getFirstReleasedAt());
        BackupData.BackupTask exportedStory = null;
        for (BackupData.BackupTask task : exported.getTasks()) {
            if ("T1".equals(task.getId())) {
                exportedStory = task;
            }
        }
        assertNotNull(exportedStory);
        assertEquals("V1", exportedStory.getVersionId());
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
        assertEquals("released", versionCaptor.getValue().getStatus());
        ArgumentCaptor<Demand> demandCaptor = ArgumentCaptor.forClass(Demand.class);
        verify(demandMapper).insert(demandCaptor.capture());
        assertEquals("D1", demandCaptor.getValue().getId());
        assertEquals("V1", demandCaptor.getValue().getVersionId());
        verify(versionTaskMapper).insertBatch(eq("W1"), eq("V1"), anyList());
        verify(taskMapper).setEpic("T1", "T9");
    }
}
