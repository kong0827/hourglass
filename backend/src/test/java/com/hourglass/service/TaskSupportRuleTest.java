package com.hourglass.service;

import com.hourglass.entity.BoardColumn;
import com.hourglass.mapper.TagMapper;
import com.hourglass.mapper.TaskMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TaskSupportRuleTest {

    private static final String WS = "W1";

    private WorkspaceMetaCache metaCache;
    private TaskSupport support;

    @BeforeEach
    void setUp() {
        metaCache = mock(WorkspaceMetaCache.class);
        support = new TaskSupport(mock(TaskMapper.class), mock(TagMapper.class), metaCache);
    }

    @Test
    void fixedColumnsKeepTheirSemantics() {
        assertEquals("backlog", support.processingRule(WS, "backlog"));
        assertEquals("normal", support.processingRule(WS, "doing"));
        assertEquals("done", support.processingRule(WS, "done"));
        assertFalse(support.canTime(WS, "backlog"));
        assertFalse(support.canTime(WS, "done"));
        assertTrue(support.countsOverdue(WS, "backlog"));
        assertFalse(support.countsOverdue(WS, "done"));
    }

    @Test
    void testColumnUsesConfiguredWaitingRule() {
        when(metaCache.column(WS, "test")).thenReturn(column("waiting"));

        assertEquals("waiting", support.processingRule(WS, "test"));
        assertFalse(support.canTime(WS, "test"));
        assertTrue(support.countsOverdue(WS, "test"));
    }

    @Test
    void testColumnUsesConfiguredEndedRule() {
        when(metaCache.column(WS, "testing")).thenReturn(column("ended"));

        assertEquals("ended", support.processingRule(WS, "testing"));
        assertFalse(support.canTime(WS, "testing"));
        assertFalse(support.countsOverdue(WS, "testing"));
    }

    @Test
    void missingRuleFallsBackToNormal() {
        when(metaCache.column(WS, "C1")).thenReturn(column(null));

        assertEquals("normal", support.processingRule(WS, "C1"));
        assertTrue(support.canTime(WS, "C1"));
    }

    private BoardColumn column(String rule) {
        BoardColumn c = new BoardColumn();
        c.setProcessingRule(rule);
        return c;
    }
}
