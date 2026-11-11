package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiAssistantBootstrapView;
import com.hourglass.dto.AiAssistantConfirmRequest;
import com.hourglass.dto.AiAssistantConfirmResponse;
import com.hourglass.dto.AiAssistantDraft;
import com.hourglass.dto.AiAssistantMessage;
import com.hourglass.dto.AiAssistantMissing;
import com.hourglass.dto.AiAssistantRequest;
import com.hourglass.dto.AiAssistantResponse;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiConfigView;
import com.hourglass.dto.AiAssistantContext;
import com.hourglass.dto.AiAssistantOption;
import com.hourglass.dto.BoardQuery;
import com.hourglass.dto.DemandActionRequest;
import com.hourglass.dto.DemandPage;
import com.hourglass.dto.DemandQuery;
import com.hourglass.dto.DemandSaveRequest;
import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.dto.TaskMoveRequest;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Task;
import com.hourglass.mapper.ProjectVersionMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 助手权限边界：隐藏项目、只读项目、他人草稿凭据都不能穿过服务端校验 */
class AiAssistantServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String WS_NAME = "测试空间";

    private final AiConfigService configService = mock(AiConfigService.class);
    private final AiClient client = mock(AiClient.class);
    private final RequirementService requirementService = mock(RequirementService.class);
    private final ProjectAccessService projectAccess = mock(ProjectAccessService.class);
    private final TaskCommandService taskService = mock(TaskCommandService.class);
    private final DemandService demandService = mock(DemandService.class);
    private final TaskWorkflowService taskWorkflow = mock(TaskWorkflowService.class);
    private final TaskQueryService taskQuery = mock(TaskQueryService.class);
    private final WorkspaceMetaCache metaCache = mock(WorkspaceMetaCache.class);
    private final ReleasePermissionService releasePermission = mock(ReleasePermissionService.class);
    private final ProjectVersionMapper versionMapper = mock(ProjectVersionMapper.class);
    private final AiAssistantService service = new AiAssistantService(
            configService, client, requirementService, projectAccess, taskService, new AssistantFaqService(),
            demandService, taskWorkflow, taskQuery, metaCache, releasePermission, versionMapper);

    @Test
    void bootstrapOnlyReturnsWritableVisibleProjects() {
        member(USER);
        when(configService.view(USER)).thenReturn(readyView());
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(
                project("P1", "可写项目"), project("P2", "只读项目"), project("P3", "隐藏项目")));
        allow("P1", true, true);
        allow("P2", true, false);
        allow("P3", false, false);

        AiAssistantBootstrapView view = service.bootstrap(USER, WS, WS_NAME);

        assertTrue(view.isAiReady());
        assertTrue(view.isCanCreate());
        assertEquals(1, view.getProjects().size());
        assertEquals("P1", view.getProjects().get(0).getId());
        assertEquals(3, view.getSuggestions().size());
    }

    @Test
    void viewerGetsNoWritableProjects() {
        when(projectAccess.roleOf(WS, USER)).thenReturn(ProjectAccessService.ROLE_VIEWER);
        when(configService.view(USER)).thenReturn(readyView());
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目")));
        allow("P1", true, false);

        AiAssistantBootstrapView view = service.bootstrap(USER, WS, WS_NAME);

        assertFalse(view.isCanCreate());
        assertTrue(view.getProjects().isEmpty());
    }

    @Test
    void faqHitDoesNotCallModel() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(new ArrayList<ReqProgress>());

        AiAssistantResponse res = service.chat(USER, WS, WS_NAME, request("如何创建一个任务？"));

        assertEquals("answer", res.getIntent());
        assertTrue(res.getAnswer().contains("新建"));
        assertTrue(res.isDegraded());
        assertNull(res.getUsage());
        assertTrue(res.getLinks().stream().anyMatch(l -> "#/board?new=1".equals(l.getHref())));
        verifyNoInteractions(client);
        verify(configService, never()).resolve(anyString());
    }

    @Test
    void hiddenProjectNeverEntersPromptAndReadOnlyProjectIsNotDrafted() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(
                project("P1", "可写甲"), project("P4", "可写乙"),
                project("P2", "只读项目"), project("P3", "隐藏项目")));
        allow("P1", true, true);
        allow("P4", true, true);
        allow("P2", true, false);
        allow("P3", false, false);
        when(configService.resolve(USER)).thenReturn(config());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), anyBoolean()))
                .thenReturn(reply("{\"intent\":\"create_task\",\"answer\":\"整理好了\","
                        + "\"links\":[{\"href\":\"#/board\"},{\"href\":\"javascript:alert(1)\"}],"
                        + "\"draft\":{\"title\":\"修复登录页\",\"itemType\":\"task\",\"reqId\":\"P2\","
                        + "\"priority\":\"P1\",\"dueDate\":\"2026-11-13\"}}"));

        AiAssistantResponse res = service.chat(USER, WS, WS_NAME, request("帮我建一个周五截止的登录页任务"));

        ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
        verify(client).chat(any(AiConfig.class), anyString(), prompt.capture(), anyBoolean());
        assertTrue(prompt.getValue().contains("可写甲"));
        assertFalse(prompt.getValue().contains("隐藏项目"), "隐藏项目不能进入提示词");
        assertTrue(prompt.getValue().contains("只读项目"), "可见只读项目可以作为上下文，但不能被选");

        assertEquals("clarify", res.getIntent());
        assertNotNull(res.getDraft());
        assertNull(res.getDraft().getReqId(), "只读项目不能被模型指定为草稿项目");
        AiAssistantMissing missing = res.getMissing().get(0);
        assertEquals("reqId", missing.getField());
        assertEquals(2, missing.getOptions().size());
        assertTrue(missing.getOptions().stream().noneMatch(o -> "P2".equals(o.getValue())));
        assertEquals(1, res.getLinks().size(), "白名单外链接必须丢弃");
        assertEquals("#/board", res.getLinks().get(0).getHref());
    }

    @Test
    void confirmUsesServerCachedDraftAndCreatesTask() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        when(configService.resolve(USER)).thenReturn(config());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), anyBoolean()))
                .thenReturn(reply("{\"intent\":\"create_task\",\"answer\":\"整理好了\","
                        + "\"draft\":{\"title\":\"登录页改版上线\",\"description\":\"完成改版并上线\","
                        + "\"itemType\":\"task\",\"reqId\":\"P1\",\"priority\":\"P1\",\"dueDate\":\"2026-11-13\"}}"));

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("帮我建一个周五截止的登录页改版任务"));
        assertNotNull(chat.getRequestId());
        assertEquals("create_task", chat.getIntent());

        Task task = new Task();
        task.setId("K100");
        task.setTitle("登录页改版上线");
        when(taskService.create(eq(USER), eq(WS), any(TaskSaveRequest.class))).thenReturn(task);

        AiAssistantConfirmRequest confirm = new AiAssistantConfirmRequest();
        confirm.setRequestId(chat.getRequestId());
        AiAssistantConfirmResponse out = service.confirm(USER, WS, confirm);

        assertEquals("K100", out.getTaskId());
        assertEquals("#/board?task=K100", out.getHref());

        ArgumentCaptor<TaskSaveRequest> save = ArgumentCaptor.forClass(TaskSaveRequest.class);
        verify(taskService).create(eq(USER), eq(WS), save.capture());
        assertEquals("P1", save.getValue().getReqId());
        assertEquals("backlog", save.getValue().getBoardColumn());
        assertEquals("P1", save.getValue().getPriority());
        assertEquals(LocalDate.of(2026, 11, 13), save.getValue().getDueDate());
        assertNull(save.getValue().getOwnerUserId(), "助手不替用户猜负责人");

        /* 重复点击同一次确认只能创建一次 */
        AiAssistantConfirmResponse again = service.confirm(USER, WS, confirm);
        assertEquals("K100", again.getTaskId());
        verify(taskService).create(eq(USER), eq(WS), any(TaskSaveRequest.class));
    }

    @Test
    void otherUserCannotUseDraftRequestId() {
        member(USER);
        String requestId = createDraft();
        member("U2");
        when(requirementService.list(WS, "U2")).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);

        AiAssistantConfirmRequest confirm = new AiAssistantConfirmRequest();
        confirm.setRequestId(requestId);

        AppException error = assertThrows(AppException.class, () -> service.confirm("U2", WS, confirm));
        assertEquals(404, error.getCode());
        verify(taskService, never()).create(anyString(), anyString(), any(TaskSaveRequest.class));
    }

    @Test
    void readonlyProjectCannotBeConfirmed() {
        member(USER);
        String requestId = createDraft();
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(
                project("P1", "项目甲"), project("P2", "只读项目")));
        allow("P1", true, true);
        allow("P2", true, false);

        AiAssistantConfirmRequest confirm = new AiAssistantConfirmRequest();
        confirm.setRequestId(requestId);
        confirm.setReqId("P2");

        AppException error = assertThrows(AppException.class, () -> service.confirm(USER, WS, confirm));
        assertEquals(403, error.getCode());
        verify(taskService, never()).create(anyString(), anyString(), any(TaskSaveRequest.class));
    }

    @Test
    void hiddenProjectReturnsNotFoundWithoutRevealingExistence() {
        member(USER);
        String requestId = createDraft();
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(
                project("P1", "项目甲"), project("P3", "隐藏项目")));
        allow("P1", true, true);
        allow("P3", false, false);

        AiAssistantConfirmRequest confirm = new AiAssistantConfirmRequest();
        confirm.setRequestId(requestId);
        confirm.setReqId("P3");

        AppException error = assertThrows(AppException.class, () -> service.confirm(USER, WS, confirm));
        assertEquals(404, error.getCode(), "不可见项目必须按不存在处理");
        verify(taskService, never()).create(anyString(), anyString(), any(TaskSaveRequest.class));
    }

    // ==================== 提需求 ====================

    @Test
    void createDemandConfirmGoesThroughDemandServiceOnWritableProject() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        modelSays("{\"intent\":\"create_demand\",\"draft\":{\"title\":\"导出对账单\",\"reqId\":\"P1\","
                + "\"itemKind\":\"功能\",\"source\":\"财务 · 刘\",\"priority\":\"P1\",\"expectDate\":\"2026-12-01\"}}");

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("帮我在项目甲提一个导出对账单的需求"));
        assertEquals("create_demand", chat.getIntent());
        assertEquals("项目甲", chat.getDraft().getProjectName());

        Demand created = demand("D1", "P1", "review", 0L);
        created.setTitle("导出对账单");
        when(demandService.create(eq(USER), eq(WS), any(DemandSaveRequest.class))).thenReturn(created);

        AiAssistantConfirmResponse out = service.confirm(USER, WS, confirmOf(chat.getRequestId()));

        assertEquals("demand", out.getKind());
        assertEquals("D1", out.getDemandId());
        assertEquals("待评审", out.getStatusName());
        ArgumentCaptor<DemandSaveRequest> save = ArgumentCaptor.forClass(DemandSaveRequest.class);
        verify(demandService).create(eq(USER), eq(WS), save.capture());
        assertEquals("P1", save.getValue().getReqId());
        assertEquals("新功能", save.getValue().getItemKind());
        assertEquals("P1", save.getValue().getPriority());
        assertEquals(LocalDate.of(2026, 12, 1), save.getValue().getExpectDate());
    }

    @Test
    void createDemandOnReadonlyOrHiddenProjectIsRejected() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(
                project("P1", "项目甲"), project("P2", "只读项目"), project("P3", "隐藏项目")));
        allow("P1", true, true);
        allow("P2", true, false);
        allow("P3", false, false);
        modelSays("{\"intent\":\"create_demand\",\"draft\":{\"title\":\"导出对账单\",\"reqId\":\"P1\"}}");
        String requestId = service.chat(USER, WS, WS_NAME, request("帮我提一个导出对账单的需求")).getRequestId();

        AiAssistantConfirmRequest readonly = confirmOf(requestId);
        readonly.setReqId("P2");
        assertEquals(403, assertThrows(AppException.class, () -> service.confirm(USER, WS, readonly)).getCode());

        AiAssistantConfirmRequest hidden = confirmOf(requestId);
        hidden.setReqId("P3");
        assertEquals(404, assertThrows(AppException.class, () -> service.confirm(USER, WS, hidden)).getCode());

        verify(demandService, never()).create(anyString(), anyString(), any(DemandSaveRequest.class));
    }

    // ==================== 需求流转 ====================

    @Test
    void demandTargetResolvedServerSideAndTitleNeverEntersPrompt() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        Demand target = demand("D1", "P1", "review", 7L);
        target.setTitle("登录页改版（内部代号 SECRET）");
        searchReturns(target);
        when(demandService.getVisible(WS, USER, "D1")).thenReturn(target);
        when(releasePermission.canManageProject(USER, WS, "P1")).thenReturn(false);
        modelSays("{\"intent\":\"demand_action\",\"draft\":{\"demandQuery\":\"登录页\",\"demandAction\":\"pass\"}}");

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("把登录页那条需求通过"));

        ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
        verify(client).chat(any(AiConfig.class), anyString(), prompt.capture(), anyBoolean());
        assertFalse(prompt.getValue().contains("SECRET"), "需求标题只在服务端解析，不能进提示词");
        assertTrue(prompt.getValue().contains("用户：把登录页那条需求通过"), "用户本轮消息必须标成用户发言");

        assertEquals("demand_action", chat.getIntent());
        AiAssistantDraft draft = chat.getDraft();
        assertEquals("D1", draft.getDemandId());
        assertEquals("pass", draft.getDemandAction());
        assertEquals("已通过", draft.getTargetStatusName());
        assertEquals(Arrays.asList("pass", "rej"), values(draft.getAllowedActions()),
                "没有管理权时不能出现取消等排期类动作");

        Demand passed = demand("D1", "P1", "pass", 8L);
        when(demandService.pass(eq(USER), eq(WS), eq("D1"), any(DemandActionRequest.class))).thenReturn(passed);

        AiAssistantConfirmResponse out = service.confirm(USER, WS, confirmOf(chat.getRequestId()));
        assertEquals("已通过", out.getStatusName());
        ArgumentCaptor<DemandActionRequest> body = ArgumentCaptor.forClass(DemandActionRequest.class);
        verify(demandService).pass(eq(USER), eq(WS), eq("D1"), body.capture());
        assertEquals(Long.valueOf(7L), body.getValue().getRevision(), "必须用服务端刚读到的 revision 做并发保护");

        service.confirm(USER, WS, confirmOf(chat.getRequestId()));
        verify(demandService).pass(eq(USER), eq(WS), eq("D1"), any(DemandActionRequest.class));
    }

    @Test
    void scheduleActionNeedsManagePermissionEvenIfClientForcesIt() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        Demand target = demand("D1", "P1", "pass", 3L);
        searchReturns(target);
        when(demandService.getVisible(WS, USER, "D1")).thenReturn(target);
        when(releasePermission.canManageProject(USER, WS, "P1")).thenReturn(false);
        modelSays("{\"intent\":\"demand_action\",\"draft\":{\"demandQuery\":\"对账\",\"demandAction\":\"plan\"}}");

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("把对账需求排期"));

        assertEquals("clarify", chat.getIntent());
        assertNull(chat.getDraft().getDemandAction(), "无权的动作不能留在草稿里");
        assertTrue(chat.getAnswer().contains("不能执行「排期」"), "被丢弃的动作要由服务端说明原因，不能沿用模型原话");
        assertEquals(Arrays.asList("unpass"), values(chat.getDraft().getAllowedActions()));

        AiAssistantConfirmRequest forced = confirmOf(chat.getRequestId());
        forced.setDemandAction("plan");
        AppException error = assertThrows(AppException.class, () -> service.confirm(USER, WS, forced));
        assertEquals(403, error.getCode());
        verify(demandService, never()).plan(anyString(), anyString(), anyString(), any(DemandActionRequest.class));
    }

    @Test
    void replanKeepsCurrentScheduleAndRejectsUnschedulableVersion() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        Demand target = demand("D1", "P1", "plan", 5L);
        target.setVersionId("V1");
        target.setVersionName("v1.0");
        target.setPlannedStart(LocalDate.of(2026, 11, 2));
        target.setPlannedEnd(LocalDate.of(2026, 11, 20));
        searchReturns(target);
        when(demandService.getVisible(WS, USER, "D1")).thenReturn(target);
        when(releasePermission.canManageProject(USER, WS, "P1")).thenReturn(true);
        ProjectVersion open = new ProjectVersion();
        open.setId("V1");
        open.setName("v1.0");
        ProjectVersion released = new ProjectVersion();
        released.setId("V0");
        released.setName("v0.9");
        released.setStatus("released");
        when(versionMapper.selectByReq(WS, "P1")).thenReturn(Arrays.asList(open, released));
        modelSays("{\"intent\":\"demand_action\",\"draft\":{\"demandQuery\":\"对账\",\"demandAction\":\"replan\",\"note\":\"依赖延期\"}}");

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("对账需求调期，依赖延期"));
        assertEquals("demand_action", chat.getIntent());
        assertEquals(Arrays.asList("V1"), values(chat.getDraft().getVersions()), "已发布版本不能作为排期目标");

        AiAssistantConfirmRequest bad = confirmOf(chat.getRequestId());
        bad.setVersionId("V0");
        assertEquals(400, assertThrows(AppException.class, () -> service.confirm(USER, WS, bad)).getCode());
        bad.setVersionId("VX");
        assertEquals(400, assertThrows(AppException.class, () -> service.confirm(USER, WS, bad)).getCode());

        when(demandService.replan(eq(USER), eq(WS), eq("D1"), any(DemandActionRequest.class))).thenReturn(target);
        service.confirm(USER, WS, confirmOf(chat.getRequestId()));
        ArgumentCaptor<DemandActionRequest> body = ArgumentCaptor.forClass(DemandActionRequest.class);
        verify(demandService).replan(eq(USER), eq(WS), eq("D1"), body.capture());
        assertEquals("V1", body.getValue().getVersionId(), "没改版本时沿用当前版本，不能被清空");
        assertEquals(LocalDate.of(2026, 11, 2), body.getValue().getPlannedStart());
        assertEquals(LocalDate.of(2026, 11, 20), body.getValue().getPlannedEnd());
        assertEquals("依赖延期", body.getValue().getNote());
    }

    @Test
    void declarativeFlowCommandIsNotHijackedByFaq() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        modelSays("{\"intent\":\"answer\",\"answer\":\"好的\"}");

        service.chat(USER, WS, WS_NAME, request("需求「明细支持导出Excel」调期，原因：依赖接口延期"));

        verify(client).chat(any(AiConfig.class), anyString(), anyString(), anyBoolean());
    }

    @Test
    void readonlyMemberCannotReviewDemand() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, false);
        Demand target = demand("D1", "P1", "review", 1L);
        target.setTitle("对账");
        searchReturns(target);
        when(demandService.getVisible(WS, USER, "D1")).thenReturn(target);
        modelSays("{\"intent\":\"demand_action\",\"draft\":{\"demandQuery\":\"对账\",\"demandAction\":\"pass\"}}");

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("把对账需求通过"));

        assertEquals("answer", chat.getIntent(), "只读成员没有任何可执行流转时只给说明");
        assertNull(chat.getRequestId(), "不下发可确认的草稿凭据");
        assertTrue(chat.getAnswer().contains("待评审"));
    }

    @Test
    void readonlyMemberGetsNoCreateDraft() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, false);
        modelSays("{\"intent\":\"create_demand\",\"draft\":{\"title\":\"对账导出\",\"reqId\":\"P1\"}}");

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("在项目甲提一个需求：对账导出"));

        assertEquals("answer", chat.getIntent());
        assertNull(chat.getRequestId(), "没有可写项目时不下发可确认的草稿凭据");
        assertNull(chat.getDraft());
    }

    @Test
    void invalidStatusAndMissingNoteAreRejectedBeforeWrite() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        Demand target = demand("D1", "P1", "review", 1L);
        searchReturns(target);
        when(demandService.getVisible(WS, USER, "D1")).thenReturn(target);
        modelSays("{\"intent\":\"demand_action\",\"draft\":{\"demandQuery\":\"对账\",\"demandAction\":\"rej\"}}");

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("把对账需求拒绝"));
        assertEquals("clarify", chat.getIntent());
        assertEquals("note", chat.getMissing().get(0).getField(), "拒绝必须填写原因");

        AppException noNote = assertThrows(AppException.class,
                () -> service.confirm(USER, WS, confirmOf(chat.getRequestId())));
        assertEquals(400, noNote.getCode());

        /* 草稿生成后需求被别人通过了：按当前状态重新校验，不能再拒绝 */
        target.setStatus("pass");
        AiAssistantConfirmRequest stale = confirmOf(chat.getRequestId());
        stale.setNote("范围不清");
        AppException wrongStatus = assertThrows(AppException.class, () -> service.confirm(USER, WS, stale));
        assertEquals(400, wrongStatus.getCode());

        verify(demandService, never()).reject(anyString(), anyString(), anyString(), any(DemandActionRequest.class));
    }

    @Test
    void invisibleDemandIsNeverResolvedAndConfirmReturnsNotFound() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        when(demandService.getVisible(WS, USER, "D9")).thenThrow(AppException.notFound("需求不存在"));
        modelSays("{\"intent\":\"demand_action\",\"draft\":{\"demandId\":\"D9\",\"demandAction\":\"pass\"}}");

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("把这条需求通过"));
        assertEquals("clarify", chat.getIntent());
        assertNull(chat.getDraft().getDemandId(), "模型给的不可见 id 不能进草稿");
        assertEquals("demandId", chat.getMissing().get(0).getField());

        AiAssistantConfirmRequest forced = confirmOf(chat.getRequestId());
        forced.setDemandId("D9");
        assertEquals(404, assertThrows(AppException.class, () -> service.confirm(USER, WS, forced)).getCode());
        verify(demandService, never()).pass(anyString(), anyString(), anyString(), any(DemandActionRequest.class));
    }

    // ==================== 工作项流转 ====================

    @Test
    void moveTaskNeverForcesAndGoesThroughWorkflowService() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        Task t = task("K1", WS, "backlog");
        TaskListResponse list = new TaskListResponse();
        list.getItems().add(t);
        when(taskQuery.list(eq(WS), eq(USER), any(BoardQuery.class), anyString(), anyInt(), anyInt(), anyBoolean()))
                .thenReturn(list);
        modelSays("{\"intent\":\"move_task\",\"draft\":{\"taskQuery\":\"登录页\",\"targetColumn\":\"进行中\"}}");

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("把登录页任务移到进行中"));
        assertEquals("move_task", chat.getIntent());
        assertEquals("K1", chat.getDraft().getTaskId());
        assertEquals("doing", chat.getDraft().getTargetColumn());
        assertEquals("待处理", chat.getDraft().getCurrentColumnName());

        Map<String, Object> moved = new HashMap<String, Object>();
        moved.put("task", t);
        moved.put("to", "doing");
        when(taskWorkflow.move(eq(USER), eq(WS), eq("K1"), any(TaskMoveRequest.class))).thenReturn(moved);

        AiAssistantConfirmResponse out = service.confirm(USER, WS, confirmOf(chat.getRequestId()));
        assertEquals("进行中", out.getStatusName());
        ArgumentCaptor<TaskMoveRequest> move = ArgumentCaptor.forClass(TaskMoveRequest.class);
        verify(taskWorkflow).move(eq(USER), eq(WS), eq("K1"), move.capture());
        assertEquals("doing", move.getValue().getColumn());
        assertEquals(Boolean.FALSE, move.getValue().getForce(), "助手永不强制越过流转规则");
    }

    @Test
    void taskFromAnotherWorkspaceIsIgnoredAndWorkflowDenialPropagates() {
        member(USER);
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        when(taskQuery.forDeepLink(USER, "K9")).thenReturn(task("K9", "W2", "backlog"));
        AiAssistantRequest req = request("把这个工作项移到进行中");
        AiAssistantContext ctx = new AiAssistantContext();
        ctx.setTaskId("K9");
        req.setContext(ctx);
        modelSays("{\"intent\":\"move_task\",\"draft\":{\"targetColumn\":\"doing\"}}");

        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, req);
        assertEquals("clarify", chat.getIntent());
        assertNull(chat.getDraft().getTaskId(), "别的空间的工作项不能成为目标");

        AiAssistantConfirmRequest forced = confirmOf(chat.getRequestId());
        forced.setTaskId("K9");
        when(taskWorkflow.move(eq(USER), eq(WS), eq("K9"), any(TaskMoveRequest.class)))
                .thenThrow(AppException.notFound("任务不存在"));
        assertEquals(404, assertThrows(AppException.class, () -> service.confirm(USER, WS, forced)).getCode());
    }

    private void modelSays(String json) {
        when(configService.resolve(USER)).thenReturn(config());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), anyBoolean())).thenReturn(reply(json));
    }

    private void searchReturns(Demand... items) {
        DemandPage page = new DemandPage();
        page.getItems().addAll(Arrays.asList(items));
        when(demandService.page(eq(WS), eq(USER), any(DemandQuery.class))).thenReturn(page);
    }

    private static AiAssistantConfirmRequest confirmOf(String requestId) {
        assertNotNull(requestId);
        AiAssistantConfirmRequest c = new AiAssistantConfirmRequest();
        c.setRequestId(requestId);
        return c;
    }

    private static Demand demand(String id, String reqId, String status, Long revision) {
        Demand d = new Demand();
        d.setId(id);
        d.setWorkspaceId(WS);
        d.setReqId(reqId);
        d.setStatus(status);
        d.setRevision(revision);
        d.setTitle("需求 " + id);
        return d;
    }

    private static Task task(String id, String workspaceId, String column) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(workspaceId);
        t.setReqId("P1");
        t.setBoardColumn(column);
        t.setTitle("登录页改版");
        return t;
    }

    private static List<String> values(List<AiAssistantOption> options) {
        List<String> out = new ArrayList<String>();
        for (AiAssistantOption o : options) {
            out.add(o.getValue());
        }
        return out;
    }

    private String createDraft() {
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "项目甲")));
        allow("P1", true, true);
        when(configService.resolve(USER)).thenReturn(config());
        when(client.chat(any(AiConfig.class), anyString(), anyString(), anyBoolean()))
                .thenReturn(reply("{\"intent\":\"create_task\",\"answer\":\"整理好了\","
                        + "\"draft\":{\"title\":\"登录页改版上线\",\"itemType\":\"task\",\"reqId\":\"P1\"}}"));
        AiAssistantResponse chat = service.chat(USER, WS, WS_NAME, request("帮我建一个登录页改版任务"));
        assertNotNull(chat.getRequestId());
        return chat.getRequestId();
    }

    private void member(String userId) {
        when(projectAccess.roleOf(WS, userId)).thenReturn(ProjectAccessService.ROLE_MEMBER);
    }

    private void allow(String projectId, boolean canView, boolean canWrite) {
        when(projectAccess.canView(WS, USER, projectId)).thenReturn(canView);
        when(projectAccess.canWrite(WS, USER, projectId)).thenReturn(canWrite);
    }

    private static AiAssistantRequest request(String message) {
        AiAssistantMessage m = new AiAssistantMessage();
        m.setRole("user");
        m.setContent(message);
        List<AiAssistantMessage> list = new ArrayList<AiAssistantMessage>();
        list.add(m);
        AiAssistantRequest req = new AiAssistantRequest();
        req.setMessages(list);
        return req;
    }

    private static AiConfig config() {
        AiConfig c = new AiConfig();
        c.setProvider("deepseek");
        c.setBaseUrl("https://api.deepseek.com/v1");
        c.setModel("deepseek-chat");
        c.setApiKey("sk-test");
        return c;
    }

    private static AiConfigView readyView() {
        AiConfigView v = new AiConfigView();
        v.setProvider("deepseek");
        v.setBaseUrl("https://api.deepseek.com/v1");
        v.setModel("deepseek-chat");
        v.setHasKey(true);
        v.setEnabled(true);
        v.setStatus("已就绪");
        return v;
    }

    private static AiClient.Reply reply(String content) {
        AiClient.Reply r = new AiClient.Reply();
        r.content = content;
        r.model = "deepseek-chat";
        r.promptTokens = 100;
        r.completionTokens = 50;
        r.jsonModeUsed = true;
        return r;
    }

    private static ReqProgress project(String id, String name) {
        ReqProgress p = new ReqProgress();
        p.setId(id);
        p.setName(name);
        return p;
    }
}
