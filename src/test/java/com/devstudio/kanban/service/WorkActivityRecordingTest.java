package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.ReqDocSaveRequest;
import com.devstudio.kanban.dto.ReqSaveRequest;
import com.devstudio.kanban.entity.Demand;
import com.devstudio.kanban.entity.DocumentType;
import com.devstudio.kanban.entity.Requirement;
import com.devstudio.kanban.entity.RequirementDoc;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.DemandMapper;
import com.devstudio.kanban.mapper.RequirementDocMapper;
import com.devstudio.kanban.mapper.RequirementMapper;
import com.devstudio.kanban.mapper.TaskLogMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import com.devstudio.kanban.mapper.UserMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;

import javax.validation.Validation;
import javax.validation.ValidatorFactory;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class WorkActivityRecordingTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private RequirementMapper reqMapper;
    private RequirementDocMapper docMapper;
    private TaskMapper taskMapper;
    private DemandMapper demandMapper;
    private WorkActivityService workActivityService;
    private RequirementService requirementService;
    private RequirementDocService docService;

    @BeforeEach
    void setUp() {
        reqMapper = mock(RequirementMapper.class);
        docMapper = mock(RequirementDocMapper.class);
        taskMapper = mock(TaskMapper.class);
        demandMapper = mock(DemandMapper.class);
        UserMapper userMapper = mock(UserMapper.class);
        workActivityService = mock(WorkActivityService.class);
        /* 乐观锁：这些用例只关心活动记录，默认按更新成功返回 */
        when(docMapper.update(any(RequirementDoc.class), any())).thenReturn(1);
        docService = new RequirementDocService(docMapper, reqMapper, userMapper, taskMapper,
                workActivityService, demandMapper, mock(ProjectAccessService.class));
        requirementService = new RequirementService(reqMapper, mock(TaskMapper.class), mock(TaskLogMapper.class),
                mock(ActivityService.class), workActivityService, docService,
                mock(ProjectVersionService.class), mock(com.devstudio.kanban.mapper.ProjectVersionMapper.class),
                mock(DemandMapper.class), mock(ProjectAccessService.class));
    }

    @Test
    void projectCreateUpdateAndFirstReleaseWriteExpectedDetails() {
        ReqSaveRequest create = projectRequest("新项目", "初始描述", "active");
        create.setId("R1");
        requirementService.create(WS, USER, create);
        verify(workActivityService).recordCurrent(WS, WorkActivityService.PROJECT, "R1",
                "create", "创建了项目「新项目」");

        Requirement old = project("R1", WS, "旧项目", "旧描述", "active");
        when(reqMapper.selectById("R1")).thenReturn(old);
        requirementService.update(WS, USER, "R1", projectRequest("新项目", "新描述", "done"));

        ArgumentCaptor<String> updates = ArgumentCaptor.forClass(String.class);
        verify(workActivityService, times(3)).recordCurrent(eq(WS), eq(WorkActivityService.PROJECT), eq("R1"),
                eq("update"), updates.capture());
        assertEquals(Arrays.asList("名称：旧项目 → 新项目", "描述：旧描述 → 新描述", "状态：active → done"),
                updates.getAllValues());

        old.setFirstReleasedAt(LocalDate.of(2026, 10, 1));
        requirementService.markFirstRelease(WS, "R1", LocalDate.of(2026, 11, 3));
        verify(workActivityService).recordCurrent(WS, WorkActivityService.PROJECT, "R1", "first_release",
                "首版上线日期：2026-10-01 → 2026-11-03");
    }

    @Test
    void requirementDocUpdateRecordsEveryChangedFieldWithoutHtml() {
        RequirementDoc old = new RequirementDoc();
        old.setId("D1");
        old.setWorkspaceId(WS);
        old.setReqId("R1");
        old.setTitle("旧标题");
        old.setDocType(DocumentType.REQUIREMENT.getCode());
        old.setContent("<p>old</p>");
        old.setStatus("draft");
        old.setOwner("Alice");
        old.setOwnerUserId("U2");
        when(docMapper.selectById("D1")).thenReturn(old);
        when(reqMapper.selectById("R1")).thenReturn(project("R1", WS, "旧项目", null, "active"));
        when(reqMapper.selectById("R2")).thenReturn(project("R2", WS, "新项目", null, "active"));

        ReqDocSaveRequest request = new ReqDocSaveRequest();
        request.setReqId("R2");
        request.setTitle("新标题");
        request.setDocType(DocumentType.TECHNICAL.getCode());
        request.setContent("<p><strong>new</strong></p>");
        request.setStatus("done");
        request.setOwner("Bob");
        docService.update(USER, WS, "D1", request);

        ArgumentCaptor<String> details = ArgumentCaptor.forClass(String.class);
        verify(workActivityService, times(6)).record(eq(WS), eq(WorkActivityService.REQUIREMENT_DOC), eq("D1"),
                eq(USER), eq("update"), details.capture());
        List<String> values = details.getAllValues();
        assertEquals(Arrays.asList("标题：旧标题 → 新标题", "分类：需求文档 → 技术方案", "更新了正文", "状态：draft → done",
                "负责人：Alice → Bob", "所属项目：旧项目 → 新项目"), values);
        for (String detail : values) {
            assertFalse(detail.contains("<p>"));
            assertFalse(detail.contains("<strong>"));
        }
        verify(docMapper).clearTaskRefExceptReq(WS, "D1", "R2");
    }

    @Test
    void requirementDocCreateWritesActivity() {
        when(reqMapper.selectById("R1")).thenReturn(project("R1", WS, "项目", null, "active"));
        ReqDocSaveRequest request = new ReqDocSaveRequest();
        request.setReqId("R1");
        request.setTitle("需求标题");
        request.setContent("<p>正文</p>");
        request.setStatus("draft");
        request.setOwner("Alice");

        docService.create(USER, WS, request);

        verify(workActivityService).record(eq(WS), eq(WorkActivityService.REQUIREMENT_DOC),
                org.mockito.ArgumentMatchers.startsWith("D"), eq(USER), eq("create"),
                eq("创建了文档「需求标题」"));
    }

    @ParameterizedTest
    @EnumSource(DocumentType.class)
    void createsAllDocumentTypesInMultilevelTree(DocumentType type) {
        stubDocumentTree();
        ReqDocSaveRequest request = documentRequest(type.getCode());

        docService.create(USER, WS, request);

        ArgumentCaptor<RequirementDoc> saved = ArgumentCaptor.forClass(RequirementDoc.class);
        verify(docMapper).insert(saved.capture());
        RequirementDoc doc = saved.getValue();
        assertEquals(type.getCode(), doc.getDocType());
        assertEquals("Dparent", doc.getParentId());
        assertEquals("R1", doc.getReqId());
        assertEquals("markdown", doc.getFormat());
        assertEquals("**正文**", doc.getContent());
        assertEquals("正文", doc.getContentBrief());
        assertEquals(0, doc.getSortOrder());
        try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {
            assertTrue(factory.getValidator().validate(request).isEmpty());
        }
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = " ")
    void creationWithNoTypeDefaultsToOther(String code) {
        stubDocumentTree();
        docService.create(USER, WS, documentRequest(code));

        ArgumentCaptor<RequirementDoc> saved = ArgumentCaptor.forClass(RequirementDoc.class);
        verify(docMapper).insert(saved.capture());
        assertEquals(DocumentType.OTHER.getCode(), saved.getValue().getDocType());
    }

    @ParameterizedTest
    @EnumSource(DocumentType.class)
    void changesClassificationWithoutChangingTreeOrAssociations(DocumentType type) {
        stubDocumentTree();
        DocumentType previous = type == DocumentType.OTHER ? DocumentType.REQUIREMENT : DocumentType.OTHER;
        RequirementDoc old = document("D1", previous);
        old.setParentId("Dparent");
        old.setSortOrder(7);
        when(docMapper.selectById("D1")).thenReturn(old);

        RequirementDoc updated = docService.update(USER, WS, "D1", documentRequest(type.getCode()));

        assertSame(old, updated);
        assertEquals(type.getCode(), updated.getDocType());
        assertEquals("Dparent", updated.getParentId());
        assertEquals(7, updated.getSortOrder());
        assertEquals("R1", updated.getReqId());
        assertEquals("markdown", updated.getFormat());
        assertEquals("**正文**", updated.getContent());
        verify(workActivityService).record(WS, WorkActivityService.REQUIREMENT_DOC, "D1", USER, "update",
                "分类：" + previous.getLabel() + " → " + type.getLabel());
        verify(docMapper, never()).clearTaskRef(anyString(), anyString());
        verify(docMapper, never()).clearTaskRefExceptReq(anyString(), anyString(), anyString());
        verify(docMapper, never()).reparentChildren(anyString(), anyString(), any());
        verify(docMapper, never()).deleteDemandLinksByDoc(anyString(), anyString());

        Demand demand = new Demand();
        demand.setId("DM1");
        demand.setWorkspaceId(WS);
        demand.setReqId("R1");
        when(demandMapper.selectById("DM1")).thenReturn(demand);
        docService.linkDemand(WS, "DM1", "D1", USER);
        verify(docMapper).linkDemand(WS, "DM1", "D1", USER);
        List<Task> tasks = Collections.singletonList(new Task());
        when(taskMapper.selectByReqDoc(WS, "D1")).thenReturn(tasks);
        assertSame(tasks, docService.tasks(WS, "D1"));
    }

    @ParameterizedTest
    @EnumSource(DocumentType.class)
    void omittedOrUnchangedTypeKeepsExistingClassificationWithoutActivity(DocumentType type) {
        stubDocumentTree();
        RequirementDoc old = document("D1", type);
        old.setParentId("Dparent");
        when(docMapper.selectById("D1")).thenReturn(old);

        for (String code : new String[]{null, "", " ", type.getCode()}) {
            docService.update(USER, WS, "D1", documentRequest(code));
            assertEquals(type.getCode(), old.getDocType());
        }
        verifyNoInteractions(workActivityService);
    }

    @Test
    void editingLegacyDocumentWithoutTypeDefaultsToOther() {
        stubDocumentTree();
        RequirementDoc old = document("D1", DocumentType.OTHER);
        old.setDocType(null);
        old.setParentId("Dparent");
        when(docMapper.selectById("D1")).thenReturn(old);

        docService.update(USER, WS, "D1", documentRequest(null));

        assertEquals(DocumentType.OTHER.getCode(), old.getDocType());
        verifyNoInteractions(workActivityService);
    }

    @ParameterizedTest
    @ValueSource(strings = {"invalid", "TECHNICAL", "1", "requirements", "technical-solution"})
    void invalidClassificationIsRejectedOnCreateAndUpdate(String code) {
        stubDocumentTree();
        RequirementDoc old = document("D1", DocumentType.REQUIREMENT);
        when(docMapper.selectById("D1")).thenReturn(old);
        ReqDocSaveRequest request = documentRequest(code);

        AppException createError = assertThrows(AppException.class, () -> docService.create(USER, WS, request));
        AppException updateError = assertThrows(AppException.class, () -> docService.update(USER, WS, "D1", request));

        assertEquals(400, createError.getCode());
        assertEquals("文档分类不合法", updateError.getMessage());
        assertEquals(DocumentType.REQUIREMENT.getCode(), old.getDocType());
        verify(docMapper, never()).insert(any(RequirementDoc.class));
        verify(docMapper, never()).update(any(RequirementDoc.class), any());
        verifyNoInteractions(workActivityService);
        try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {
            assertTrue(factory.getValidator().validate(request).stream()
                    .anyMatch(v -> "docType".equals(v.getPropertyPath().toString())));
        }
    }

    @ParameterizedTest
    @EnumSource(DocumentType.class)
    void classificationDoesNotBypassParentValidation(DocumentType type) {
        stubDocumentTree();
        RequirementDoc old = document("D1", type);
        when(docMapper.selectById("D1")).thenReturn(old);
        ReqDocSaveRequest request = documentRequest(type.getCode());
        request.setParentId("D1");
        assertThrows(AppException.class, () -> docService.update(USER, WS, "D1", request));

        RequirementDoc child = document("Dchild", DocumentType.OTHER);
        child.setParentId("D1");
        when(docMapper.selectById("Dchild")).thenReturn(child);
        request.setParentId("Dchild");
        assertThrows(AppException.class, () -> docService.update(USER, WS, "D1", request));

        RequirementDoc otherProject = document("Dother", DocumentType.TECHNICAL);
        otherProject.setReqId("R2");
        when(docMapper.selectById("Dother")).thenReturn(otherProject);
        request.setParentId("Dother");
        assertThrows(AppException.class, () -> docService.update(USER, WS, "D1", request));
        verify(docMapper, never()).update(any(RequirementDoc.class), any());
    }

    @Test
    void missingDocumentUsesDocumentMessageButDemandKeepsDemandMessage() {
        assertEquals("文档不存在：Dmissing",
                assertThrows(AppException.class, () -> docService.get(WS, "Dmissing")).getMessage());
        assertEquals("需求不存在：DMmissing",
                assertThrows(AppException.class, () -> docService.docsOfDemand(WS, "DMmissing")).getMessage());
    }

    @Test
    void activityQueriesRejectEntitiesFromAnotherWorkspace() {
        when(reqMapper.selectById("R1")).thenReturn(project("R1", "W2", "其他空间项目", null, "active"));
        assertThrows(AppException.class, () -> requirementService.activities(WS, USER, "R1"));
        verify(workActivityService, never()).listByEntity(WS, WorkActivityService.PROJECT, "R1");

        RequirementDoc other = new RequirementDoc();
        other.setId("D1");
        other.setWorkspaceId("W2");
        when(docMapper.selectById("D1")).thenReturn(other);
        assertThrows(AppException.class, () -> docService.activities(WS, "D1"));
        verify(workActivityService, never()).listByEntity(WS, WorkActivityService.REQUIREMENT_DOC, "D1");
    }

    private void stubDocumentTree() {
        when(reqMapper.selectById("R1")).thenReturn(project("R1", WS, "项目", null, "active"));
        RequirementDoc root = document("Droot", DocumentType.OTHER);
        RequirementDoc parent = document("Dparent", DocumentType.TECHNICAL);
        parent.setParentId("Droot");
        when(docMapper.selectById("Droot")).thenReturn(root);
        when(docMapper.selectById("Dparent")).thenReturn(parent);
    }

    private static RequirementDoc document(String id, DocumentType type) {
        RequirementDoc doc = new RequirementDoc();
        doc.setId(id);
        doc.setWorkspaceId(WS);
        doc.setReqId("R1");
        doc.setTitle("文档标题");
        doc.setDocType(type.getCode());
        doc.setFormat("markdown");
        doc.setContent("**正文**");
        doc.setStatus("draft");
        doc.setOwner("Alice");
        return doc;
    }

    private static ReqDocSaveRequest documentRequest(String code) {
        ReqDocSaveRequest request = new ReqDocSaveRequest();
        request.setReqId("R1");
        request.setTitle("文档标题");
        request.setDocType(code);
        request.setParentId("Dparent");
        request.setFormat("markdown");
        request.setContent("**正文**");
        request.setStatus("draft");
        request.setOwner("Alice");
        return request;
    }

    private static ReqSaveRequest projectRequest(String name, String description, String status) {
        ReqSaveRequest request = new ReqSaveRequest();
        request.setName(name);
        request.setDescription(description);
        request.setStatus(status);
        return request;
    }

    private static Requirement project(String id, String workspaceId, String name, String description, String status) {
        Requirement project = new Requirement();
        project.setId(id);
        project.setWorkspaceId(workspaceId);
        project.setName(name);
        project.setDescription(description);
        project.setStatus(status);
        return project;
    }
}
