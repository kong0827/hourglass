package com.hourglass.wecom;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WeComSafePathTest {

    @Test
    void acceptsInternalPaths() {
        assertEquals("/#/board?task=K123", WeComSafePath.of("/#/board?task=K123", "/"));
        assertEquals("/release?id=V1&plan=P1&tab=plan",
                WeComSafePath.of("/release?id=V1&plan=P1&tab=plan", "/"));
        assertEquals("/mywork", WeComSafePath.of(" /mywork ", "/"));
    }

    @Test
    void rejectsExternalOrAmbiguousTargets() {
        assertEquals("/", WeComSafePath.of("https://evil.example", "/"));
        assertEquals("/", WeComSafePath.of("//evil.example", "/"));
        assertEquals("/", WeComSafePath.of("/\\evil.example", "/"));
        assertEquals("/", WeComSafePath.of("javascript:alert(1)", "/"));
        assertEquals("/", WeComSafePath.of("/a\nb", "/"));
        assertEquals("/", WeComSafePath.of("mywork", "/"));
    }

    @Test
    void refusesToLoopBackIntoLoginOrEntry() {
        assertEquals("/home", WeComSafePath.of("/login.html?next=/x", "/home"));
        assertEquals("/home", WeComSafePath.of("/wecom/entry?c=abcdef", "/home"));
    }

    @Test
    void fallbackIsUsedWhenEmpty() {
        assertEquals("/mywork", WeComSafePath.of(null, "/mywork"));
        assertEquals("/", WeComSafePath.of("", null));
    }
}