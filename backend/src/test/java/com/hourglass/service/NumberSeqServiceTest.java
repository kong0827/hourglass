package com.hourglass.service;

import com.hourglass.mapper.NumberSeqMapper;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 取号 = 先自增、再读回；读回缺失直接失败，不回退到 MAX+1 编造编号。 */
class NumberSeqServiceTest {

    private final NumberSeqMapper mapper = mock(NumberSeqMapper.class);
    private final NumberSeqService service = new NumberSeqService(mapper);

    @Test
    void demandAndCaseAllocateInsideTheirProject() {
        when(mapper.selectNext("W", "demand", "R1")).thenReturn(7);
        when(mapper.selectNext("W", "case", "R1")).thenReturn(3);

        assertEquals(7, service.nextDemand("W", "R1"));
        assertEquals(3, service.nextCase("W", "R1"));

        InOrder order = inOrder(mapper);
        order.verify(mapper).bump("W", "demand", "R1");
        order.verify(mapper).selectNext("W", "demand", "R1");
        order.verify(mapper).bump("W", "case", "R1");
        order.verify(mapper).selectNext("W", "case", "R1");
    }

    @Test
    void planAllocatesPerWorkspaceWithEmptyScope() {
        when(mapper.selectNext("W", "plan", "")).thenReturn(12);

        assertEquals(12, service.nextPlan("W"));

        verify(mapper).bump("W", "plan", "");
    }

    @Test
    void missingSequenceRowFailsInsteadOfGuessing() {
        when(mapper.selectNext("W", "demand", "R1")).thenReturn(null);

        assertThrows(IllegalStateException.class, () -> service.nextDemand("W", "R1"));
    }

    @Test
    void restoreOnlyRaisesPositiveNumbers() {
        service.raiseCase("W", "R1", 0);
        service.raiseDemand("W", "R1", -1);

        verify(mapper, never()).raiseTo("W", "case", "R1", 0);
        verify(mapper, never()).raiseTo("W", "demand", "R1", -1);

        service.raiseCase("W", "R1", 9);
        verify(mapper).raiseTo("W", "case", "R1", 9);
    }
}
