package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.GanttDepRequest;
import com.hourglass.dto.TaskDependencyView;
import com.hourglass.entity.Task;
import com.hourglass.entity.TaskDependency;
import com.hourglass.mapper.GanttShareMapper;
import com.hourglass.mapper.TaskBaselineMapper;
import com.hourglass.mapper.TaskDependencyMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 甘特依赖的写入口必须校验两端任务的所属项目：项目只读成员不能增删改连线。 */
class GanttDependencyAccessTest {

    private static final String WS = "W1";
    private static final String USER = "U2";

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final TaskDependencyMapper deps = mock(TaskDependencyMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final GanttService service = new GanttService(mock(TaskQueryService.class), tasks, deps,
            mock(TaskBaselineMapper.class), mock(GanttShareMapper.class), mock(TimeLogMapper.class),
            mock(UserMapper.class), mock(WorkspaceMapper.class), access, mock(PriorityService.class));

    @Test
    void createRejectsReadOnlyEndpoint() {
        givenTask("T1", "P1");
        givenTask("T2", "P2");
        doThrow(new AppException(403, "你对该项目只有查看权限"))
                .when(access).assertWrite(WS, USER, "P2");

        assertThrows(AppException.class, () -> service.createDep(WS, USER, request("T1", "T2")));
        verify(deps, never()).insert(any(TaskDependency.class));
    }

    @Test
    void createSucceedsWhenBothProjectsAreWritable() {
        givenTask("T1", "P1");
        givenTask("T2", "P2");

        service.createDep(WS, USER, request("T1", "T2"));

        verify(access).assertWrite(WS, USER, "P1");
        verify(access).assertWrite(WS, USER, "P2");
        verify(deps).insert(any(TaskDependency.class));
    }

    @Test
    void updateRejectsReadOnlyEndpoint() {
        givenTask("T1", "P1");
        givenTask("T2", "P2");
        when(deps.selectById("D1")).thenReturn(dependency("D1", "T1", "T2"));
        doThrow(new AppException(403, "你对该项目只有查看权限"))
                .when(access).assertWrite(WS, USER, "P2");

        assertThrows(AppException.class, () -> service.updateDep(WS, USER, "D1", request("T1", "T2")));
        verify(deps, never()).update(any(TaskDependency.class));
    }

    @Test
    void deleteRejectsReadOnlyEndpoint() {
        givenTask("T1", "P1");
        givenTask("T2", "P2");
        when(deps.selectById("D1")).thenReturn(dependency("D1", "T1", "T2"));
        doThrow(new AppException(403, "你对该项目只有查看权限"))
                .when(access).assertWrite(WS, USER, "P2");

        assertThrows(AppException.class, () -> service.deleteDep(WS, USER, "D1"));
        verify(deps, never()).deleteById(anyString(), anyString());
    }

    @Test
    void taskDependenciesRejectsMissingTask() {
        assertThrows(AppException.class, () -> service.taskDependencies(WS, USER, "T404"));
        verify(access, never()).assertViewTask(anyString(), anyString(), any(Task.class));
    }

    @Test
    void taskDependenciesReturnsEndpointsAndEditability() {
        givenTask("T1", "P1");
        givenTask("T2", "P2");
        when(access.viewerScope(WS, USER)).thenReturn(USER);
        when(deps.selectVisibleByTask(WS, "T1", USER))
                .thenReturn(Collections.singletonList(dependency("D1", "T2", "T1")));
        when(access.canWrite(WS, USER, "P1")).thenReturn(true);
        when(access.canWrite(WS, USER, "P2")).thenReturn(false);

        List<TaskDependencyView> views = service.taskDependencies(WS, USER, "T1");

        assertEquals(1, views.size());
        TaskDependencyView view = views.get(0);
        assertEquals("T2", view.getFrom().getId());
        assertEquals("T1", view.getTo().getId());
        assertEquals("FS", view.getDepType());
        /* 任一端只读时整条边只读，抽屉里不出现删除入口 */
        assertFalse(view.isEditable());
        verify(access).assertViewTask(WS, USER, tasks.selectById("T1"));    }

    @Test
    void taskDependenciesEditableWhenBothProjectsWritable() {
        givenTask("T1", "P1");
        givenTask("T2", "P2");
        when(deps.selectVisibleByTask(WS, "T1", null))
                .thenReturn(Collections.singletonList(dependency("D1", "T1", "T2")));
        when(access.canWrite(WS, USER, "P1")).thenReturn(true);
        when(access.canWrite(WS, USER, "P2")).thenReturn(true);

        List<TaskDependencyView> views = service.taskDependencies(WS, USER, "T1");

        assertEquals(1, views.size());
        assertTrue(views.get(0).isEditable());
    }

    private void givenTask(String id, String reqId) {
        Task t = new Task();
        t.setId(id);
        t.setWorkspaceId(WS);
        t.setReqId(reqId);
        when(tasks.selectById(id)).thenReturn(t);
    }

    private static GanttDepRequest request(String from, String to) {
        GanttDepRequest req = new GanttDepRequest();
        req.setFromTaskId(from);
        req.setToTaskId(to);
        return req;
    }

    private static TaskDependency dependency(String id, String from, String to) {
        TaskDependency d = new TaskDependency();
        d.setId(id);
        d.setWorkspaceId(WS);
        d.setFromTaskId(from);
        d.setToTaskId(to);
        d.setDepType("FS");
        return d;
    }
}
