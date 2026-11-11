package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ColumnRequest;
import com.hourglass.entity.BoardColumn;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.ColumnTransitionMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class BoardColumnServiceTest {

    private static final String WS = "W1";

    private BoardColumnMapper mapper;
    private WorkspaceMetaCache metaCache;
    private TaskMapper taskMapper;
    private DeletionTraceService deletionTrace;
    private BoardColumnService service;

    @BeforeEach
    void setUp() {
        mapper = mock(BoardColumnMapper.class);
        metaCache = mock(WorkspaceMetaCache.class);
        taskMapper = mock(TaskMapper.class);
        deletionTrace = mock(DeletionTraceService.class);
        when(metaCache.columns(WS)).thenReturn(Collections.<BoardColumn>emptyList());
        service = new BoardColumnService(mapper, mock(ColumnTransitionMapper.class), taskMapper,
                mock(ActivityService.class), deletionTrace, metaCache);
    }

    @Test
    void deletingCustomColumnLogsMovedTasksIntoTheirTimeline() {
        BoardColumn custom = column("C1", "验收", "normal");
        BoardColumn backlog = column("backlog", "待处理", "normal");
        when(mapper.selectById(WS, "C1")).thenReturn(custom);
        when(metaCache.columns(WS)).thenReturn(java.util.Arrays.asList(backlog, custom));
        when(taskMapper.selectIdsByColumnForCascade(WS, "C1"))
                .thenReturn(java.util.Arrays.asList("K1", "K2"));
        when(taskMapper.selectAll(WS)).thenReturn(Collections.emptyList());

        service.delete("U1", WS, "C1");

        verify(deletionTrace).logTaskCascade(WS, "U1", java.util.Arrays.asList("K1", "K2"),
                "因删除看板列「验收」，自动移入「待处理」");
    }

    @Test
    void builtInColumnAllowsRenameAndColorButKeepsProcessingRule() {
        BoardColumn c = column("backlog", "待处理", "normal");
        when(mapper.selectById(WS, "backlog")).thenReturn(c);

        ColumnRequest req = new ColumnRequest();
        req.setName("待办");
        req.setColor("#112233");
        req.setProcessingRule("ended");

        BoardColumn updated = service.update(WS, "backlog", req);

        assertEquals("待办", updated.getName());
        assertEquals("#112233", updated.getColor());
        assertEquals("normal", updated.getProcessingRule(), "内置列的处理规则不可被修改");
        verify(mapper).update(c);
    }

    @Test
    void doingColumnKeepsProcessingRule() {
        BoardColumn c = column("doing", "进行中", "normal");
        when(mapper.selectById(WS, "doing")).thenReturn(c);

        ColumnRequest req = new ColumnRequest();
        req.setName("开发中");
        req.setColor("#112233");
        req.setProcessingRule("ended");

        BoardColumn updated = service.update(WS, "doing", req);

        assertEquals("开发中", updated.getName());
        assertEquals("normal", updated.getProcessingRule(), "「进行中」的处理规则固定为正常计时");
        verify(mapper).update(c);
    }

    @Test
    void testColumnProcessingRuleCanChange() {
        BoardColumn c = column("test", "待测试", "waiting");
        when(mapper.selectById(WS, "test")).thenReturn(c);

        ColumnRequest req = new ColumnRequest();
        req.setName("待验收");
        req.setColor("#112233");
        req.setProcessingRule("ended");

        BoardColumn updated = service.update(WS, "test", req);

        assertEquals("待验收", updated.getName());
        assertEquals("ended", updated.getProcessingRule());
        verify(mapper).update(c);
    }

    @Test
    void customColumnProcessingRuleCanChange() {
        BoardColumn c = column("C1", "等待中", "normal");
        when(mapper.selectById(WS, "C1")).thenReturn(c);

        ColumnRequest req = new ColumnRequest();
        req.setName("等待中");
        req.setColor("#445566");
        req.setProcessingRule("waiting");

        BoardColumn updated = service.update(WS, "C1", req);

        assertEquals("waiting", updated.getProcessingRule());
        verify(mapper).update(c);
    }

    @Test
    void updatingWithoutRuleKeepsTestColumnProcessingRule() {
        BoardColumn c = column("test", "待测试", "waiting");
        when(mapper.selectById(WS, "test")).thenReturn(c);

        ColumnRequest req = new ColumnRequest();
        req.setName("待验收");
        req.setColor("#112233");

        BoardColumn updated = service.update(WS, "test", req);

        assertEquals("waiting", updated.getProcessingRule(), "不带规则更新时不能被重置为 normal");
    }

    @Test
    void updatingFixedColumnNormalizesLegacyRule() {
        BoardColumn c = column("doing", "进行中", "waiting");
        when(mapper.selectById(WS, "doing")).thenReturn(c);

        ColumnRequest req = new ColumnRequest();
        req.setName("进行中");
        req.setColor("#112233");

        BoardColumn updated = service.update(WS, "doing", req);

        assertEquals("normal", updated.getProcessingRule(), "固定列在库里统一落 normal");
    }

    @Test
    void doneColumnCannotBeDeleted() {
        AppException ex = assertThrows(AppException.class, () -> service.delete("U1", WS, "done"));
        assertEquals(400, ex.getCode());
        verifyNoInteractions(mapper);
    }

    private BoardColumn column(String id, String name, String rule) {
        BoardColumn c = new BoardColumn();
        c.setId(id);
        c.setWorkspaceId(WS);
        c.setName(name);
        c.setColor("#8a8578");
        c.setProcessingRule(rule);
        c.setSortOrder(0);
        return c;
    }
}
