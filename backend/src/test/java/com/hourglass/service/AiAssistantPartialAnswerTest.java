package com.hourglass.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** 流式输出只要半截 JSON 里的 answer，正文里的同名字样不能被误认成字段 */
class AiAssistantPartialAnswerTest {

    @Test
    void extractsAnswerWhileJsonIsStillIncomplete() {
        assertEquals("你好", AiAssistantService.partialAnswer(
                "{\"intent\":\"answer\",\"answer\":\"你好"));
    }

    @Test
    void ignoresAnswerWordInsideValuePosition() {
        assertNull(AiAssistantService.partialAnswer("{\"foo\":\"answer\"}"));
    }

    @Test
    void decodesEscapes() {
        assertEquals("a\nb \"c\"", AiAssistantService.partialAnswer(
                "{\"answer\":\"a\\nb \\\"c\\\"\"}"));
    }

    @Test
    void dropsIncompleteUnicodeEscapeInsteadOfShowingGarbage() {
        assertEquals("x", AiAssistantService.partialAnswer("{\"answer\":\"x\\u4e"));
        assertNull(AiAssistantService.partialAnswer("{\"answer\":\"\\u4e"));
    }

    @Test
    void waitsUntilAnswerKeyAppears() {
        assertNull(AiAssistantService.partialAnswer("{\"intent\":\"ans"));
        assertNull(AiAssistantService.partialAnswer(null));
    }

    @Test
    void acceptsAnswerAfterCommaAndWhitespace() {
        assertEquals("done", AiAssistantService.partialAnswer(
                "{\"a\":1,\n \"answer\" : \"done\""));
    }
}
