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
}