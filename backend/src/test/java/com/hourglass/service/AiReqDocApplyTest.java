package com.hourglass.service;

import com.hourglass.common.AiClient;
import com.hourglass.common.AppException;
import com.hourglass.dto.AiApplyResult;
import com.hourglass.dto.AiSplitResponse;
import com.hourglass.dto.GanttDepRequest;
import com.hourglass.dto.TaskSaveRequest;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.Task;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 拆分草稿落地：本项目内去重、按草稿下标连依赖、连线失败不影响已建工作项 */
class AiReqDocApplyTest {

    private static final String WS = "W1";
    private static final String USER = "U1";
    private static final String DOC = "DOC1";
    private static final String PROJECT = "P1";

    private final RequirementDocService docs = mock(RequirementDocService.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskCommandService taskService = mock(TaskCommandService.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final GanttService gantt = mock(GanttService.class);
    private final AiReqDocService service = new AiReqDocService(docs, tasks, mock(AiConfigService.class),
            mock(AiClient.class), taskService, access, gantt);
    private int seq;

    @BeforeEach
    void setUp() {
        RequirementDoc doc = new RequirementDoc();
        doc.setId(DOC);
        doc.setReqId(PROJECT);
        when(docs.getVisible(WS, USER, DOC)).thenReturn(doc);
        when(tasks.selectTitlesByReq(eq(WS), eq(PROJECT), anyInt())).thenReturn(Collections.singletonList("已有工作项"));
        when(taskService.create(eq(USER), eq(WS), any(TaskSaveRequest.class))).thenAnswer(inv -> {
            Task t = new Task();
            t.setId("T" + (++seq));
            return t;
        });
    }

    private static AiSplitResponse.DraftTask draft(String title, int draftIndex, int dependsOn) {
        AiSplitResponse.DraftTask d = new AiSplitResponse.DraftTask();
        d.setTitle(title);
        d.setPriority("P1");
        d.setDraftIndex(draftIndex);
        d.setDependsOnIndex(dependsOn);
        return d;
    }

    @Test
    void linksDependencyByOriginalDraftIndex() {
        /* 原草稿 0→1→2，用户取消勾选了 1：2 依赖的前置不存在，不连；0 与 3 照常 */
        List<AiSplitResponse.DraftTask> picked = new ArrayList<AiSplitResponse.DraftTask>(Arrays.asList(
                draft("建表", 0, -1), draft("接口联调", 2, 1), draft("接口实现", 3, 0)));
        AiApplyResult r = service.applyTasks(USER, WS, DOC, picked);

        assertEquals(3, r.getCreated());
        assertEquals(1, r.getLinked());
        ArgumentCaptor<GanttDepRequest> dep = ArgumentCaptor.forClass(GanttDepRequest.class);
        verify(gantt, times(1)).createDep(eq(WS), eq(USER), dep.capture());
        assertEquals("T1", dep.getValue().getFromTaskId());
        assertEquals("T3", dep.getValue().getToTaskId());
        assertEquals("FS", dep.getValue().getDepType());
    }

    @Test
    void dedupesOnlyWithinDocProject() {
        AiApplyResult r = service.applyTasks(USER, WS, DOC, Arrays.asList(
                draft("已有工作项", 0, -1), draft("新工作项", 1, 0)));

        assertEquals(1, r.getCreated());
        assertEquals(1, r.getSkipped());
        assertEquals(0, r.getLinked(), "前置被跳过时不连线");
        verify(tasks, never()).selectTitles(anyString(), any());
        verify(gantt, never()).createDep(anyString(), anyString(), any(GanttDepRequest.class));
    }

    @Test
    void dependencyFailureKeepsCreatedTasks() {
        when(gantt.createDep(anyString(), anyString(), any(GanttDepRequest.class)))
                .thenThrow(AppException.badRequest("依赖数量已达上限"));
        AiApplyResult r = service.applyTasks(USER, WS, DOC, Arrays.asList(
                draft("A", 0, -1), draft("B", 1, 0)));

        assertEquals(2, r.getCreated());
        assertEquals(0, r.getLinked());
        assertEquals(0, r.getFailed().size());
    }
}
