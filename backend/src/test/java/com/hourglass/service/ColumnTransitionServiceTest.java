package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.ColumnTransition;
import com.hourglass.mapper.ColumnTransitionMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ColumnTransitionServiceTest {

    private static final String WS = "W1";

    private ColumnTransitionMapper mapper;
    private BoardColumnService columnService;
    private WorkspaceMetaCache metaCache;
    private ColumnTransitionService service;

    @BeforeEach
    void setUp() {
        mapper = mock(ColumnTransitionMapper.class);
        columnService = mock(BoardColumnService.class);
        metaCache = mock(WorkspaceMetaCache.class);
        when(metaCache.transitions(WS)).thenReturn(Collections.<ColumnTransition>emptyList());
        when(columnService.list(WS)).thenReturn(Collections.<BoardColumn>emptyList());
        service = new ColumnTransitionService(mapper, columnService, metaCache);
    }

    @Test
    void defaultRulesKeepNormalMovesOpenAndRequireReasonForReopen() {
        assertEquals("allow", service.defaultRule("backlog", "doing"));
        assertEquals("reason", service.defaultRule("done", "doing"));
        assertEquals("allow", service.defaultRule("doing", "done"));
    }

    @Test
    void blankReasonDoesNotSatisfyReasonRule() {
        AppException ex = assertThrows(AppException.class,
                () -> service.check(WS, "done", "doing", "   ", false, false));
        assertEquals(412, ex.getCode());
    }

    @Test
    void reasonIsTrimmedAndPassedToMoveLog() {
        ColumnTransitionService.Decision decision =
                service.check(WS, "done", "doing", "  验证不通过  ", false, false);
        assertEquals("reason", decision.getRule());
        assertEquals("验证不通过", decision.getReason());
        assertTrue(!decision.isForced());
    }

    @Test
    void explicitAllowOverridesDefaultReason() {
        ColumnTransition allow = rule("done", "doing", "allow");
        List<ColumnTransition> rules = new ArrayList<ColumnTransition>();
        rules.add(allow);
        when(metaCache.transitions(WS)).thenReturn(rules);

        ColumnTransitionService.Decision decision =
                service.check(WS, "done", "doing", null, false, false);
        assertEquals("allow", decision.getRule());
        assertNull(decision.getReason());
    }

    @Test
    void denyRequiresManagerToForce() {
        List<ColumnTransition> rules = new ArrayList<ColumnTransition>();
        rules.add(rule("doing", "done", "deny"));
        when(metaCache.transitions(WS)).thenReturn(rules);

        AppException noForce = assertThrows(AppException.class,
                () -> service.check(WS, "doing", "done", null, false, false));
        assertEquals(422, noForce.getCode());

        AppException memberForce = assertThrows(AppException.class,
                () -> service.check(WS, "doing", "done", null, true, false));
        assertEquals(403, memberForce.getCode());

        ColumnTransitionService.Decision forced =
                service.check(WS, "doing", "done", null, true, true);
        assertEquals("deny", forced.getRule());
        assertTrue(forced.isForced());
    }

    @Test
    void reasonCellAlsoRejectsMemberForce() {
        AppException memberForce = assertThrows(AppException.class,
                () -> service.check(WS, "done", "doing", null, true, false));
        assertEquals(403, memberForce.getCode());

        ColumnTransitionService.Decision forced =
                service.check(WS, "done", "doing", null, true, true);
        assertEquals("reason", forced.getRule());
        assertTrue(forced.isForced());
    }

    @Test
    void saveRejectsUnknownRule() {
        List<BoardColumn> columns = new ArrayList<BoardColumn>();
        BoardColumn doing = new BoardColumn();
        doing.setId("doing");
        doing.setName("进行中");
        columns.add(doing);
        when(columnService.list(WS)).thenReturn(columns);

        AppException ex = assertThrows(AppException.class,
                () -> service.save(WS, "doing", "done", "bogus"));
        assertEquals(400, ex.getCode());
        assertTrue(ex.getMessage().contains("allow / reason / deny"));
    }

    private static ColumnTransition rule(String from, String to, String rule) {
        ColumnTransition t = new ColumnTransition();
        t.setWorkspaceId(WS);
        t.setFromColumn(from);
        t.setToColumn(to);
        t.setRule(rule);
        return t;
    }
}
