package com.hourglass.common;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;

import static org.junit.jupiter.api.Assertions.assertEquals;

class GlobalExceptionHandlerTest {

    /** SSE 到点断开不能走通用异常分支：响应已是 event-stream，写 JSON 会二次报错 */
    @Test
    void asyncTimeoutIsHandledWithoutResponseBody() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/events");

        new GlobalExceptionHandler().handleAsyncTimeout(request);

        assertEquals(Boolean.TRUE, request.getAttribute(GlobalExceptionHandler.FAILED_ATTR));
    }

    @Test
    void unrelatedExceptionStillReturnsServerErrorBody() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/boom");

        ResponseEntity<ApiResult<Void>> result = new GlobalExceptionHandler()
                .handleOther(new IllegalStateException("boom"), request);

        assertEquals(500, result.getStatusCodeValue());
        assertEquals(500, result.getBody().getCode());
        assertEquals(Boolean.TRUE, request.getAttribute(GlobalExceptionHandler.FAILED_ATTR));
    }
}
