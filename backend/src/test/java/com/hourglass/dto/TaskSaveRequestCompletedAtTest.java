package com.hourglass.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** 完成时间升为分钟级后，对外契约里的纯日期入参仍要能落库（撤销删除恢复 / 旧脚本） */
class TaskSaveRequestCompletedAtTest {
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();

    private LocalDateTime parse(String value) throws Exception {
        String body = value == null ? "{}" : "{\"completedAt\":" + value + "}";
        return json.readValue(body, TaskSaveRequest.class).getCompletedAt();
    }

    @Test void dateOnlyStillAcceptedAsStartOfDay() throws Exception {
        assertEquals(LocalDateTime.of(2026, 11, 1, 0, 0), parse("\"2026-11-01\""));
    }

    @Test void minuteAndSecondPrecisionKept() throws Exception {
        assertEquals(LocalDateTime.of(2026, 11, 1, 15, 53), parse("\"2026-11-01T15:53\""));
        assertEquals(LocalDateTime.of(2026, 11, 1, 15, 53, 20), parse("\"2026-11-01T15:53:20\""));
    }

    @Test void absentNullAndEmptyStayNull() throws Exception {
        assertNull(parse(null));
        assertNull(parse("null"));
        assertNull(parse("\"\""));
        assertNull(parse("\"  \""));
    }
}