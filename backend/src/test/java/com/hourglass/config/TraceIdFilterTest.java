package com.hourglass.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TraceIdFilterTest {

    private final TraceIdFilter filter = new TraceIdFilter();

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    @Test
    void generatesTraceIdAndClearsItAfterRequest() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/hourglass/api/tasks");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<String> duringChain = new AtomicReference<>();

        filter.doFilter(request, response, (req, res) -> duringChain.set(MDC.get(TraceIdFilter.MDC_KEY)));

        String traceId = duringChain.get();
        assertNotNull(traceId);
        assertEquals(16, traceId.length());
        assertEquals(traceId, response.getHeader(TraceIdFilter.HEADER));
        assertNull(MDC.get(TraceIdFilter.MDC_KEY));
    }

    @Test
    void reusesUpstreamTraceId() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/hourglass/api/tasks");
        request.addHeader(TraceIdFilter.HEADER, "gw-abc12345");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<String> duringChain = new AtomicReference<>();

        filter.doFilter(request, response, (req, res) -> duringChain.set(MDC.get(TraceIdFilter.MDC_KEY)));

        assertEquals("gw-abc12345", duringChain.get());
        assertEquals("gw-abc12345", response.getHeader(TraceIdFilter.HEADER));
    }

    @Test
    void ignoresUnsafeUpstreamTraceId() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/hourglass/api/tasks");
        request.addHeader(TraceIdFilter.HEADER, "bad\nforged-line");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<String> duringChain = new AtomicReference<>();

        filter.doFilter(request, response, (req, res) -> duringChain.set(MDC.get(TraceIdFilter.MDC_KEY)));

        String traceId = duringChain.get();
        assertNotNull(traceId);
        assertFalse(traceId.contains("\n"));
        assertTrue(traceId.matches("^[a-f0-9]{16}$"));
    }
}
