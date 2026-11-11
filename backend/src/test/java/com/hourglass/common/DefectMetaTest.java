package com.hourglass.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** 缺陷回归状态随列流转推导：提交待验证 / 验证通过 / 退回返工，其余保持原值。 */
class DefectMetaTest {

    @Test
    void enteringTestOrTestingMeansSubmitted() {
        assertEquals("pending", DefectMeta.regressionForTransition(null, "backlog", "test"));
        assertEquals("pending", DefectMeta.regressionForTransition(null, "doing", "testing"));
        assertEquals("pending", DefectMeta.regressionForTransition("failed", "doing", "test"));
        assertEquals("pending", DefectMeta.regressionForTransition("passed", "done", "test"));
        assertEquals("pending", DefectMeta.regressionForTransition(null, null, "test"));
    }

    @Test
    void stayingInsideTestColumnsKeepsStatus() {
        assertEquals("pending", DefectMeta.regressionForTransition("pending", "test", "testing"));
        assertEquals("failed", DefectMeta.regressionForTransition("failed", "testing", "test"));
    }

    @Test
    void enteringDoneMeansPassed() {
        assertEquals("passed", DefectMeta.regressionForTransition("pending", "test", "done"));
        assertEquals("passed", DefectMeta.regressionForTransition("pending", "testing", "done"));
        assertEquals("passed", DefectMeta.regressionForTransition(null, "doing", "done"));
        assertEquals("passed", DefectMeta.regressionForTransition(null, null, "done"));
    }

    @Test
    void returningFromVerifyOrDoneMeansFailed() {
        assertEquals("failed", DefectMeta.regressionForTransition("pending", "test", "doing"));
        assertEquals("failed", DefectMeta.regressionForTransition("pending", "testing", "backlog"));
        assertEquals("failed", DefectMeta.regressionForTransition("passed", "done", "doing"));
        assertEquals("failed", DefectMeta.regressionForTransition("passed", "done", "backlog"));
    }

    @Test
    void ordinaryFlowKeepsStatus() {
        assertNull(DefectMeta.regressionForTransition(null, "backlog", "doing"));
        assertEquals("failed", DefectMeta.regressionForTransition("failed", "doing", "backlog"));
        assertEquals("pending", DefectMeta.regressionForTransition("pending", "test", "test"));
        assertNull(DefectMeta.regressionForTransition("", null, null));
    }
}
