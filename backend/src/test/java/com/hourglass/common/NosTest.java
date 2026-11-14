package com.hourglass.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class NosTest {

    @Test
    void numbersAreZeroPaddedToThreeDigitsAndWidenBeyond() {
        assertEquals("WI-001", Nos.workItem(1));
        assertEquals("WI-042", Nos.workItem(42));
        assertEquals("WI-1000", Nos.workItem(1000));
        assertEquals("REL-001", Nos.release(1));
        assertEquals("REL-233", Nos.release(233));
    }

    @Test
    void unnumberedRowsRenderEmptySoCallersCanFallBackToTheId() {
        assertEquals("", Nos.workItem(null));
        assertEquals("", Nos.workItem(0));
        assertEquals("", Nos.release(null));
        assertEquals("", Nos.release(-3));
    }

    @Test
    void searchRecognisesPrefixedAndBareNumbers() {
        assertEquals(Integer.valueOf(1), Nos.parseWorkItem("WI-001"));
        assertEquals(Integer.valueOf(1), Nos.parseWorkItem("wi-1"));
        assertEquals(Integer.valueOf(12), Nos.parseWorkItem("WI12"));
        assertEquals(Integer.valueOf(7), Nos.parseWorkItem(" 7 "));
        assertEquals(Integer.valueOf(1000), Nos.parseWorkItem("WI-1000"));
    }

    @Test
    void nonNumberSearchTermsStayNull() {
        assertNull(Nos.parseWorkItem(null));
        assertNull(Nos.parseWorkItem("登录"));
        assertNull(Nos.parseWorkItem("WI-"));
        assertNull(Nos.parseWorkItem("REL-001"));
        assertNull(Nos.parseWorkItem("0"));
        assertNull(Nos.parseWorkItem("WI-0"));
        /* 超出 int 范围的长数字不解析，避免 NumberFormatException 打断搜索 */
        assertNull(Nos.parseWorkItem("12345678"));
        assertNull(Nos.parseWorkItem("12 34"));
    }

    @Test
    void demandAndPlanNumbersUseTheSameForm() {
        assertEquals("DM-001", Nos.demand(1));
        assertEquals("DM-042", Nos.demand(42));
        assertEquals("", Nos.demand(null));
        assertEquals("PL-001", Nos.releasePlan(1));
        assertEquals("PL-120", Nos.releasePlan(120));
        assertEquals("", Nos.releasePlan(0));
    }

    @Test
    void demandAndPlanSearchesOnlyAcceptTheirOwnPrefix() {
        assertEquals(Integer.valueOf(3), Nos.parseDemand("DM-003"));
        assertEquals(Integer.valueOf(3), Nos.parseDemand("dm3"));
        assertEquals(Integer.valueOf(3), Nos.parseDemand("3"));
        assertNull(Nos.parseDemand("WI-003"));
        assertEquals(Integer.valueOf(5), Nos.parseReleasePlan("PL-005"));
        assertEquals(Integer.valueOf(5), Nos.parseReleasePlan("pl5"));
        assertEquals(Integer.valueOf(5), Nos.parseReleasePlan("5"));
        assertNull(Nos.parseReleasePlan("DM-005"));
        assertNull(Nos.parseDemand("需求"));
    }

    @Test
    void caseNumbersUseTheSameFormAndOnlyAcceptTheirOwnPrefix() {
        assertEquals("TC-001", Nos.testCase(1));
        assertEquals("TC-1000", Nos.testCase(1000));
        assertEquals("", Nos.testCase(null));
        assertEquals("", Nos.testCase(0));
        assertEquals(Integer.valueOf(9), Nos.parseCase("TC-009"));
        assertEquals(Integer.valueOf(9), Nos.parseCase("tc9"));
        assertEquals(Integer.valueOf(9), Nos.parseCase("9"));
        assertNull(Nos.parseCase("WI-009"));
        assertNull(Nos.parseCase("登录"));
    }
}