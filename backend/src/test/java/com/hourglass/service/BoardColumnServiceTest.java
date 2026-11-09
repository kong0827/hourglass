package com.hourglass.service;

import com.hourglass.dto.ColumnRequest;
import com.hourglass.entity.BoardColumn;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.ColumnTransitionMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BoardColumnServiceTest {

    private static final String WS = "W1";

    private BoardColumnMapper mapper;
    private WorkspaceMetaCache metaCache;
    private BoardColumnService service;

    @BeforeEach
    void setUp() {
        mapper = mock(BoardColumnMapper.class);
        metaCache = mock(WorkspaceMetaCache.class);
        when(metaCache.columns(WS)).thenReturn(Collections.<BoardColumn>emptyList());
        service = new BoardColumnService(mapper, mock(ColumnTransitionMapper.class), mock(TaskMapper.class),
                mock(ActivityService.class), metaCache);
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
