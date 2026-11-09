package com.hourglass.service;

import com.hourglass.common.Consts;
import com.hourglass.entity.BoardColumn;
import com.hourglass.mapper.AttachmentMapper;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.AttachmentMapper;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.ColumnTransitionMapper;
import com.hourglass.mapper.DevBranchMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.ProjectVersionMapper;
import com.hourglass.mapper.SubtaskMapper;
import com.hourglass.mapper.TagMapper;
import com.hourglass.mapper.TaskLogMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.TimeLogMapper;
import com.hourglass.mapper.VersionTaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 一次 move/update 里 columnName 多次调用只应读一次列定义。 */
class TaskServiceColumnCacheTest {

    private static final String WS = "S1";

    @Test
    void columnNameAndIndexMapShareOneColumnLoad() {
        BoardColumnMapper columnMapper = mock(BoardColumnMapper.class);
        when(columnMapper.selectAll(WS)).thenReturn(Arrays.asList(
                column("C1", "待处理", 0), column("C2", "进行中", 1)));
        WorkspaceMetaCache metaCache = new WorkspaceMetaCache(columnMapper, mock(CategoryMapper.class),
                mock(TagMapper.class), mock(ColumnTransitionMapper.class), new WorkspaceVersionService(),
                300_000L, new AtomicLong(0L)::get);

        TaskSupport support = new TaskSupport(mock(TaskMapper.class), mock(TagMapper.class), metaCache);
        TaskQueryService service = new TaskQueryService(
                mock(TaskMapper.class), mock(RequirementMapper.class), mock(ProjectVersionMapper.class),
                mock(TaskLogMapper.class),
                mock(SubtaskMapper.class), mock(TagMapper.class), mock(TimeLogMapper.class),
                mock(AttachmentMapper.class), metaCache, support, mock(VersionTaskMapper.class),
                mock(ProjectAccessService.class));

        assertEquals("待处理", support.columnName(WS, "C1"));
        assertEquals("进行中", support.columnName(WS, "C2"));
        assertEquals("已完成", support.columnName(WS, Consts.COL_DONE));

        Map<String, Integer> index = service.columnIndexMap(WS);
        assertEquals(Arrays.asList("C1", "C2", Consts.COL_DONE), new ArrayList<String>(index.keySet()));
        assertEquals(Integer.valueOf(0), index.get("C1"));
        assertEquals(Integer.valueOf(2), index.get(Consts.COL_DONE));

        verify(columnMapper, times(1)).selectAll(WS);
        verify(columnMapper, never()).selectById(anyString(), anyString());
    }

    private static BoardColumn column(String id, String name, int sort) {
        BoardColumn c = new BoardColumn();
        c.setId(id);
        c.setWorkspaceId(WS);
        c.setName(name);
        c.setSortOrder(sort);
        return c;
    }
}
