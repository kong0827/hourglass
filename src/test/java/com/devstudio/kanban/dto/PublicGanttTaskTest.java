package com.devstudio.kanban.dto;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** 公开分享必须是白名单：新增字段时这条测试会失败，提醒同步评审 */
class PublicGanttTaskTest {

    @Test
    void onlyWhitelistedFieldsAreExposed() {
        List<String> fields = Arrays.stream(PublicGanttTask.class.getDeclaredFields())
                .map(Field::getName).sorted().collect(Collectors.toList());
        assertEquals(Arrays.asList("blocked", "boardColumn", "dueDate", "estimateMinutes", "id",
                        "isMilestone", "owner", "priority", "progress", "startDate", "title", "totalMinutes"),
                fields);
    }
}
