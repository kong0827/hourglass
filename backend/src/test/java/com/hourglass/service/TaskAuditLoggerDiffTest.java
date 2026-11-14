package com.hourglass.service;

import com.hourglass.entity.Task;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskLogMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/** 工作项编辑差异补齐：类型/史诗/里程碑/缺陷/阻塞前置/提醒对象都必须进入时间线。 */
class TaskAuditLoggerDiffTest {

    private TaskAuditLogger audit;

    @BeforeEach
    void setUp() {
        audit = new TaskAuditLogger(mock(TaskLogMapper.class), mock(RequirementMapper.class),
                mock(WorkspaceMetaCache.class), new com.fasterxml.jackson.databind.ObjectMapper());
    }

    @Test
    void typeEpicMilestoneAndDefectFieldsAreIncluded() {
        Task old = task();
        Task now = task();
        now.setItemType("bug");
        now.setEpicId("E1");
        now.setIsMilestone(Boolean.TRUE);
        now.setSeverity("critical");
        now.setEnvironment("生产");
        now.setReproduceSteps("打开页面");
        now.setFoundVersionId("V1");
        now.setRegressionStatus("pending");

        List<String> parts = audit.diffParts("W1", old, now,
                Collections.<String>emptyList(), Collections.<String>emptyList());

        assertEquals(8, parts.size());
        assertTrue(parts.contains("类型 任务→缺陷"));
        assertTrue(parts.contains("挂到史诗"));
        assertTrue(parts.contains("设为里程碑"));
        assertTrue(parts.contains("严重程度 未定级→严重"));
        assertTrue(parts.contains("缺陷环境变更"));
        assertTrue(parts.contains("复现步骤变更"));
        assertTrue(parts.contains("发现版本变更"));
        assertTrue(parts.contains("回归状态 未标记→待回归"));
    }

    @Test
    void blockedByAndRemindTargetAreIncludedEvenWhenReasonUnchanged() {
        Task old = task();
        old.setBlocked(Boolean.TRUE);
        old.setBlockedReason("等联调");
        old.setBlockedByTaskId("K1");
        old.setRemindTarget("owner");
        Task now = task();
        now.setBlocked(Boolean.TRUE);
        now.setBlockedReason("等联调");
        now.setBlockedByTaskId("K2");
        now.setRemindTarget("members");

        List<String> parts = audit.diffParts("W1", old, now,
                Collections.<String>emptyList(), Collections.<String>emptyList());

        assertEquals(2, parts.size());
        assertTrue(parts.contains("前置任务变更"));
        assertTrue(parts.contains("提醒对象变更"));
    }

    @Test
    void clearingEpicAndMilestoneProducesReadableDiff() {
        Task old = task();
        old.setEpicId("E1");
        old.setIsMilestone(Boolean.TRUE);
        Task now = task();

        List<String> parts = audit.diffParts("W1", old, now,
                Collections.<String>emptyList(), Collections.<String>emptyList());

        assertEquals(2, parts.size());
        assertTrue(parts.contains("解除史诗归属"));
        assertTrue(parts.contains("取消里程碑"));
    }

    @Test
    void testOwnerReassignAndClearAreIncluded() {
        Task old = task();
        old.setTestOwnerUserId("U1");
        old.setTestOwner("测试甲");
        Task now = task();
        now.setTestOwnerUserId("U2");
        now.setTestOwner("测试乙");

        List<String> parts = audit.diffParts("W1", old, now,
                Collections.<String>emptyList(), Collections.<String>emptyList());

        assertEquals(1, parts.size());
        assertTrue(parts.contains("测试负责人 测试甲→测试乙"));

        List<String> cleared = audit.diffParts("W1", now, task(),
                Collections.<String>emptyList(), Collections.<String>emptyList());

        assertEquals(1, cleared.size());
        assertTrue(cleared.contains("测试负责人 测试乙→待领取"));
    }

    private static Task task() {
        Task t = new Task();
        t.setWorkspaceId("W1");
        t.setTitle("任务");
        t.setItemType("task");
        t.setIsMilestone(Boolean.FALSE);
        return t;
    }
}
