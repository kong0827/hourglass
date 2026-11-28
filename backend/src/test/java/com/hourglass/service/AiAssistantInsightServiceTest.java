package com.hourglass.service;

import com.hourglass.dto.AiAssistantContext;
import com.hourglass.dto.AiAssistantFact;
import com.hourglass.dto.AiAssistantResponse;
import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Task;
import com.hourglass.mapper.UserMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 只读查询层：路由要保守，统计只能覆盖可见范围。 */
class AiAssistantInsightServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final RequirementService requirementService = mock(RequirementService.class);
    private final ProjectAccessService projectAccess = mock(ProjectAccessService.class);
    private final TaskQueryService taskQuery = mock(TaskQueryService.class);
    private final ManagerService managerService = mock(ManagerService.class);
    private final VersionPhaseService versionPhaseService = mock(VersionPhaseService.class);
    private final DeliveryNoteService deliveryNoteService = mock(DeliveryNoteService.class);
    private final DemandService demandService = mock(DemandService.class);
    private final ActivityService activityService = mock(ActivityService.class);
    private final WorkspaceMetaCache metaCache = mock(WorkspaceMetaCache.class);
    private final UserMapper userMapper = mock(UserMapper.class);

    private final AiAssistantInsightService service = new AiAssistantInsightService(
            requirementService, projectAccess, taskQuery, managerService, versionPhaseService,
            deliveryNoteService, demandService, activityService, metaCache, userMapper);

    @Test
    void detectRoutesDataQuestionsButNotHowToOrWrites() {
        assertEquals("my_work", service.detect("我这周还有什么没做完？", null));
        assertEquals("project_health", service.detect("哪个项目风险最高？", null));
        assertEquals("team_load", service.detect("谁最忙？", null));
        assertEquals("demand_gaps", service.detect("有哪些需求没排期？", null));
        assertEquals("release_readiness", service.detect("v2.3 能发了吗？", null));

        AiAssistantContext demand = new AiAssistantContext();
        demand.setDemandId("D1");
        assertEquals("demand_trace", service.detect("这个需求到哪了？", demand));

        AiAssistantContext version = new AiAssistantContext();
        version.setVersionId("V1");
        assertEquals("version_progress", service.detect("现在进度到哪了？", version));

        assertNull(service.detect("怎么创建工作项？", null), "咨询类走 FAQ");
        assertNull(service.detect("帮我把这条任务移到进行中", null), "写动作不能走只读查询");
        assertNull(service.detect("今天天气怎么样", null), "无关问题不硬套工具");
    }

    @Test
    void runReturnsNullForUnsupportedTool() {
        assertNull(service.run("unknown", USER, WS, null, "随便问问", null));
    }

    @Test
    void myWorkCountsOnlyVisibleOwnOpenTasks() {
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "支付网关")));
        when(projectAccess.canView(WS, USER, "P1")).thenReturn(true);
        when(projectAccess.canView(WS, USER, "PX")).thenReturn(false);

        AppUser me = new AppUser();
        me.setDisplayName("孔祥金");
        when(userMapper.selectById(USER)).thenReturn(me);

        when(metaCache.columns(WS)).thenReturn(Arrays.asList(column("doing", "进行中", "active"),
                column("done", "已完成", "ended")));

        LocalDate today = LocalDate.now();
        List<Task> items = new ArrayList<Task>();
        items.add(task("T1", "P1", "doing", "U1", today.minusDays(1), false));
        items.add(task("T2", "P1", "doing", "U1", today, false));
        items.add(task("T3", "P1", "doing", "U1", today.plusDays(2), true));
        items.add(task("T4", "P1", "done", "U1", today.minusDays(3), false));
        items.add(task("T5", "PX", "doing", "U1", today.minusDays(5), false));
        items.add(task("T6", "P1", "doing", "U2", today.minusDays(5), false));
        TaskListResponse page = new TaskListResponse();
        page.setItems(items);
        when(taskQuery.list(eq(WS), eq(USER), any(), anyString(), anyInt(), anyInt(), anyBoolean()))
                .thenReturn(page);

        AiAssistantResponse res = service.run("my_work", USER, WS, null, "我的工作", null);

        assertNotNull(res);
        assertEquals("query", res.getIntent());
        assertEquals("my_work", res.getQueryType());
        assertEquals(3, res.getTotal(), "只统计本人负责、可见项目、未结束列的工作项");
        assertFact(res, "已逾期", "1 项");
        assertFact(res, "今天到期", "1 项");
        assertFact(res, "被阻塞", "1 项");
        assertEquals(3, res.getTasks().size());
        assertEquals("T3", res.getTasks().get(0).getId(), "阻塞项排在最前");
    }

    @Test
    void projectHealthUsesPortfolioCardAndRiskTasks() {
        when(requirementService.list(WS, USER)).thenReturn(Arrays.asList(project("P1", "支付网关")));
        when(projectAccess.canView(WS, USER, "P1")).thenReturn(true);

        Map<String, Object> card = new HashMap<String, Object>();
        card.put("reqId", "P1");
        card.put("name", "支付网关");
        card.put("health", "red");
        card.put("total", 20);
        card.put("done", 8);
        card.put("progressPct", 40);
        card.put("overdue", 3);
        card.put("blocked", 2);
        card.put("doing", 5);
        card.put("backlog", 7);
        card.put("stagnantDays", 5);
        card.put("overloadedMembers", 1);

        Map<String, Object> risky = new HashMap<String, Object>();
        risky.put("reqId", "P1");
        risky.put("boardColumn", "doing");
        risky.put("blocked", true);
        risky.put("dueDate", LocalDate.now().minusDays(2).toString());
        risky.put("title", "登录改造");

        Map<String, Object> data = new HashMap<String, Object>();
        data.put("projects", Arrays.asList(card));
        data.put("tasks", Arrays.asList(risky));
        when(managerService.portfolio(WS, USER)).thenReturn(data);

        AiAssistantContext ctx = new AiAssistantContext();
        ctx.setProjectId("P1");
        AiAssistantResponse res = service.run("project_health", USER, WS, ctx, "这个项目健康度怎么样", null);

        assertNotNull(res);
        assertEquals("支付网关", res.getContextLabel());
        assertFact(res, "健康度", "风险高");
        assertFact(res, "完成率", "40%");
        assertFact(res, "超载成员", "1 人");
        assertTrue(res.getAnswer().contains("支付网关"));
    }

    @Test
    void toolFailureDegradesToReadableAnswer() {
        when(requirementService.list(WS, USER)).thenThrow(new RuntimeException("db down"));
        AiAssistantResponse res = service.run("my_work", USER, WS, null, "我的工作", null);
        assertNotNull(res);
        assertTrue(res.getAnswer().contains("没有取到数据"));
    }

    private static void assertFact(AiAssistantResponse res, String label, String value) {
        for (AiAssistantFact f : res.getFacts()) {
            if (label.equals(f.getLabel())) {
                assertEquals(value, f.getValue());
                return;
            }
        }
        throw new AssertionError("没有找到指标：" + label);
    }

    private static ReqProgress project(String id, String name) {
        ReqProgress p = new ReqProgress();
        p.setId(id);
        p.setName(name);
        return p;
    }

    private static BoardColumn column(String id, String name, String rule) {
        BoardColumn c = new BoardColumn();
        c.setId(id);
        c.setName(name);
        c.setProcessingRule(rule);
        return c;
    }

    private static Task task(String id, String reqId, String column, String ownerUserId,
                             LocalDate due, boolean blocked) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(WS);
        t.setReqId(reqId);
        t.setBoardColumn(column);
        t.setOwnerUserId(ownerUserId);
        t.setDueDate(due);
        t.setBlocked(blocked);
        t.setTitle(id);
        return t;
    }
}
