package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiApplyResult;
import com.hourglass.dto.AiConfig;
import com.hourglass.dto.AiSplitResponse;
import com.hourglass.dto.GanttDepRequest;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Task;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 需求池需求拆分：草稿只标重复不删除、落库口径与手动新建一致、去重与依赖 */
class AiDemandSplitServiceTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String DEMAND = "D1";
    private static final String PROJECT = "P1";

    private final DemandService demands = mock(DemandService.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final AiConfigService configs = mock(AiConfigService.class);
    private final AiClient client = mock(AiClient.class);
    private final TaskCommandService taskService = mock(TaskCommandService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final GanttService gantt = mock(GanttService.class);
    private final AiDemandSplitService service = new AiDemandSplitService(demands, tasks, configs,
            client, taskService, access, gantt);
    private int seq;

    @BeforeEach
    void setUp() {
        when(configs.resolve(USER, WS)).thenReturn(mock(AiConfig.class));
        when(taskService.create(eq(USER), eq(WS), any(TaskSaveRequest.class))).thenAnswer(inv -> {
            Task t = new Task();
            t.setId("T" + (++seq));
            return t;
        });
    }

    private static Demand demand(String status) {
        Demand d = new Demand();
        d.setId(DEMAND);
        d.setWorkspaceId(WS);
        d.setReqId(PROJECT);
        d.setTitle("出金申请");
        d.setStatus(status);
        d.setPriority("P1");
        d.setDescription("用户提交出金申请，需要填写金额和收款账号");
        d.setAcceptText("金额不能超过可用余额；重复提交要幂等");
        d.setCategoryId("C1");
        d.setPlannedStart(LocalDate.of(2026, 11, 18));
        d.setPlannedEnd(LocalDate.of(2026, 11, 22));
        return d;
    }

    private static Task existing(String title) {
        Task t = new Task();
        t.setId("E" + title.hashCode());
        t.setTitle(title);
        t.setBoardColumn("backlog");
        t.setProgress(0);
        return t;
    }

    private static AiSplitResponse.DraftTask draft(String title, int index, int dep) {
        AiSplitResponse.DraftTask d = new AiSplitResponse.DraftTask();
        d.setTitle(title);
        d.setPriority("P1");
        d.setDraftIndex(index);
        d.setDependsOnIndex(dep);
        return d;
    }

    @Test
    void splitMarksExistingTitleAsDuplicateAndKeepsIt() {
        when(demands.getVisible(WS, USER, DEMAND)).thenReturn(demand("pass"));
        when(tasks.selectByDemand(WS, DEMAND)).thenReturn(Collections.singletonList(existing("实现出金校验")));
        AiClient.Reply reply = new AiClient.Reply();
        reply.content = "{\"summary\":\"按接口和校验拆\",\"tasks\":["
                + "{\"title\":\"实现出金校验\",\"priority\":\"P1\",\"dependsOnIndex\":-1},"
                + "{\"title\":\"实现出金申请接口\",\"description\":\"提交后落库\",\"priority\":\"high\",\"dependsOnIndex\":0}"
                + "]}";
        when(client.chat(any(), anyString(), anyString(), eq(true))).thenReturn(reply);

        AiSplitResponse res = service.split(USER, WS, DEMAND, null);

        assertEquals(2, res.getTasks().size(), "同名项保留给用户看，而不是直接丢掉");
        assertEquals("按接口和校验拆", res.getSummary());
        assertTrue(res.getTasks().get(0).isDuplicate());
        assertFalse(res.getTasks().get(0).isSelected());
        assertEquals("实现出金校验", res.getTasks().get(0).getDuplicateOf());
        assertFalse(res.getTasks().get(1).isDuplicate());
        assertTrue(res.getTasks().get(1).isSelected());
        assertEquals("P0", res.getTasks().get(1).getPriority());
        assertEquals(1, res.getTasks().get(1).getDraftIndex());
        assertTrue(res.getDemandChars() > 0);
    }

    @Test
    void applyUsesManualSplitDefaultsAndLinksDependency() {
        when(demands.getVisible(WS, USER, DEMAND)).thenReturn(demand("pass"));
        when(tasks.selectByDemand(WS, DEMAND)).thenReturn(Collections.singletonList(existing("已有项")));

        List<AiSplitResponse.DraftTask> picked = new ArrayList<AiSplitResponse.DraftTask>(Arrays.asList(
                draft("已有项", 0, -1), draft("实现出金接口", 1, -1), draft("补幂等校验", 2, 1)));
        AiApplyResult r = service.applyTasks(USER, WS, DEMAND, picked);

        assertEquals(2, r.getCreated());
        assertEquals(1, r.getSkipped());
        assertEquals(1, r.getLinked());
        ArgumentCaptor<TaskSaveRequest> req = ArgumentCaptor.forClass(TaskSaveRequest.class);
        verify(taskService, org.mockito.Mockito.times(2)).create(eq(USER), eq(WS), req.capture());
        TaskSaveRequest first = req.getAllValues().get(0);
        assertEquals(DEMAND, first.getDemandId());
        assertEquals(PROJECT, first.getReqId());
        assertEquals("C1", first.getCategoryId());
        assertEquals("backlog", first.getBoardColumn());
        assertEquals(LocalDate.of(2026, 11, 18), first.getStartDate());
        assertEquals(LocalDate.of(2026, 11, 22), first.getDueDate());
        ArgumentCaptor<GanttDepRequest> dep = ArgumentCaptor.forClass(GanttDepRequest.class);
        verify(gantt).createDep(eq(WS), eq(USER), dep.capture());
        assertEquals("T1", dep.getValue().getFromTaskId());
        assertEquals("T2", dep.getValue().getToTaskId());
    }

    @Test
    void applyRejectsClosedDemandBeforeCreatingAnything() {
        when(demands.getVisible(WS, USER, DEMAND)).thenReturn(demand("closed"));

        try {
            service.applyTasks(USER, WS, DEMAND, Collections.singletonList(draft("A", 0, -1)));
        } catch (AppException e) {
            assertTrue(e.getMessage().contains("不能新拆工作项"));
        }
        verify(taskService, never()).create(anyString(), anyString(), any(TaskSaveRequest.class));
    }

    @Test
    void sourceTextKeepsDescriptionAndAcceptanceSeparated() {
        String text = AiDemandSplitService.sourceText(demand("pass"));
        assertTrue(text.contains("【需求描述】"));
        assertTrue(text.contains("【验收标准】"));
        assertTrue(text.indexOf("【需求描述】") < text.indexOf("【验收标准】"));
    }

    @Test
    void titleKeyIgnoresSpacesAndCase() {
        assertEquals(AiDemandSplitService.titleKey(" Add  Login "), AiDemandSplitService.titleKey("addlogin"));
    }
}
