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
import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.Task;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
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
    private final AiAssistantService service = new AiAssistantService(
            configService, client, requirementService, projectAccess, taskService, new AssistantFaqService());

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
