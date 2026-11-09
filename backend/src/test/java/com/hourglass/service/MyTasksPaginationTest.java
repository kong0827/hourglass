package com.hourglass.service;

import com.hourglass.dto.BoardQuery;
import com.hourglass.dto.MyTaskWorkspace;
import com.hourglass.dto.MyTasksPage;
import com.hourglass.dto.MyTasksQuery;
import com.hourglass.entity.Task;
import com.hourglass.mapper.AttachmentMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TagMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.VersionTaskMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** TOP-6：我的任务分页参数收敛与独立 COUNT。 */
class MyTasksPaginationTest {

    private final TaskMapper taskMapper = mock(TaskMapper.class);

    private TaskQueryService service() {
        WorkspaceMetaCache metaCache = mock(WorkspaceMetaCache.class);
        TaskSupport support = new TaskSupport(taskMapper, mock(TagMapper.class), metaCache);
        TaskQueryService service = new TaskQueryService(taskMapper, mock(RequirementMapper.class), mock(ProjectVersionMapper.class),
                mock(TaskLogMapper.class),
                mock(SubtaskMapper.class), mock(TagMapper.class), mock(TimeLogMapper.class),
                mock(AttachmentMapper.class), metaCache, support, mock(VersionTaskMapper.class),
                mock(ProjectAccessService.class), mock(ReleasePermissionService.class));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "publications", mock(TaskPublicationService.class));
        return service;
    }

    @Test
    void clampsNegativeOffsetAndOversizedLimit() {
        when(taskMapper.countMyTasks(any(MyTasksQuery.class))).thenReturn(1200, 40);
        when(taskMapper.selectMyTasks(any(MyTasksQuery.class))).thenReturn(Collections.<Task>emptyList());
        when(taskMapper.selectMyTaskWorkspaces(any(MyTasksQuery.class)))
                .thenReturn(Collections.<MyTaskWorkspace>emptyList());

        MyTasksPage page = service().myTasksPage("U1", "我", true, new BoardQuery(), -5, 9999);

        assertEquals(1200, page.getTotal());
        ArgumentCaptor<MyTasksQuery> captor = ArgumentCaptor.forClass(MyTasksQuery.class);
        verify(taskMapper).selectMyTasks(captor.capture());
        assertEquals(0, captor.getValue().getOffset());
        assertEquals(TaskQueryService.MY_TASKS_MAX_LIMIT, captor.getValue().getLimit());
        // 两次 COUNT：一次 total，一次"仅显示名匹配"（nameOnly 覆盖全量而非本页）
        verify(taskMapper, times(2)).countMyTasks(any(MyTasksQuery.class));
        assertEquals(40, page.getNameOnly());
    }

    @Test
    void offsetBeyondTotalSkipsListQuery() {
        when(taskMapper.countMyTasks(any(MyTasksQuery.class))).thenReturn(5, 0);
        when(taskMapper.selectMyTaskWorkspaces(any(MyTasksQuery.class)))
                .thenReturn(Collections.<MyTaskWorkspace>emptyList());

        MyTasksPage page = service().myTasksPage("U1", "我", true, new BoardQuery(), 10, 200);

        assertEquals(5, page.getTotal());
        assertEquals(0, page.getItems().size());
        verify(taskMapper, never()).selectMyTasks(any(MyTasksQuery.class));
    }

    @Test
    void pageKeepsFilterAndLimitOnListQuery() {
        when(taskMapper.countMyTasks(any(MyTasksQuery.class))).thenReturn(3, 0);
        List<Task> items = new ArrayList<Task>();
        Task t = new Task();
        t.setId("K1");
        t.setWorkspaceId("W1");
        items.add(t);
        when(taskMapper.selectMyTasks(any(MyTasksQuery.class))).thenReturn(items);
        when(taskMapper.selectMyTaskWorkspaces(any(MyTasksQuery.class)))
                .thenReturn(Collections.<MyTaskWorkspace>emptyList());

        BoardQuery query = BoardQuery.from(null, null, "P0", null, null, null, null, null,
                null, null, null, null, null, null, null);
        MyTasksPage page = service().myTasksPage("U1", "我", false, query, 0, 25);

        assertEquals(3, page.getTotal());
        assertEquals(1, page.getItems().size());
        ArgumentCaptor<MyTasksQuery> captor = ArgumentCaptor.forClass(MyTasksQuery.class);
        verify(taskMapper).selectMyTasks(captor.capture());
        assertEquals(25, captor.getValue().getLimit());
        assertEquals(1, captor.getValue().getPris().size());
        assertEquals("P0", captor.getValue().getPris().get(0));
    }
}
