package com.hourglass.common;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GlobalExceptionHandlerTest {

    /** SSE 到点断开不能走通用异常分支：响应已是 event-stream，写 JSON 会二次报错 */
    @Test
    void asyncTimeoutIsHandledWithoutResponseBody() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/events");

        new GlobalExceptionHandler().handleAsyncTimeout(request);

        assertEquals(Boolean.TRUE, request.getAttribute(GlobalExceptionHandler.FAILED_ATTR));
    }

    /** 缺必填查询参数属于客户端错误，不能落到通用分支变成 500 */
    @Test
    void missingRequiredParameterReturnsBadRequestNamingTheParameter() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/versions/stats");

        ResponseEntity<ApiResult<Void>> result = new GlobalExceptionHandler().handleMissingParameter(
                new org.springframework.web.bind.MissingServletRequestParameterException("reqId", "String"), request);

        assertEquals(400, result.getStatusCodeValue());
        assertEquals(400, result.getBody().getCode());
        assertTrue(result.getBody().getMessage().contains("reqId"));
        assertEquals(Boolean.TRUE, request.getAttribute(GlobalExceptionHandler.FAILED_ATTR));
    }

    /** 业务 4xx 不抛栈，必须主动留痕：否则线上只能靠前端截图才看得见原因 */
    @Test
    void businessRejectionIsLoggedWithCodeAndPath() {
        ch.qos.logback.classic.Logger logger =
                (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(GlobalExceptionHandler.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender =
                new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        try {
            MockHttpServletRequest request = new MockHttpServletRequest("PUT", "/api/tasks/K299");
            new GlobalExceptionHandler().handleAppException(
                    AppException.badRequest("所选需求池需求不属于该项目"), request);

            String logged = appender.list.stream()
                    .map(ch.qos.logback.classic.spi.ILoggingEvent::getFormattedMessage)
                    .reduce("", (a, b) -> a + "\n" + b);
            assertTrue(logged.contains("code=400"));
            assertTrue(logged.contains("/api/tasks/K299"));
            assertTrue(logged.contains("所选需求池需求不属于该项目"));
        } finally {
            logger.detachAppender(appender);
        }
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

    /** SSE 心跳写到已断开的连接不算服务端故障：不写 500 错误体，也不按 ERROR 记录 */
    @Test
    void brokenPipeIsHandledWithoutResponseBody() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/events");
        MockHttpServletResponse response = new MockHttpServletResponse();
        response.setContentType("text/event-stream");

        Object result = new GlobalExceptionHandler()
                .handleIo(new java.io.IOException("Broken pipe"), request, response);

        assertEquals(null, result);
        assertEquals(Boolean.TRUE, request.getAttribute(GlobalExceptionHandler.FAILED_ATTR));
    }

    /** 中文 JDK 的「断开的管道」同样按客户端断开处理 */
    @Test
    void localizedBrokenPipeIsHandledWithoutResponseBody() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/events");

        Object result = new GlobalExceptionHandler()
                .handleIo(new java.io.IOException("断开的管道"), request, new MockHttpServletResponse());

        assertEquals(null, result);
    }

    /** event-stream 已定响应类型时，即使不是断连也不能再写 JSON 错误体，否则异常处理器二次报错 */
    @Test
    void eventStreamIoFailureDoesNotWriteJsonBody() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/events");
        MockHttpServletResponse response = new MockHttpServletResponse();
        response.setContentType("text/event-stream");

        Object result = new GlobalExceptionHandler()
                .handleIo(new java.io.IOException("连接到主机失败"), request, response);

        assertEquals(null, result);
        assertEquals(0, response.getContentAsByteArray().length);
    }

    /** 真正的 IO 故障仍要返回 500，不能被断连分支吞掉 */
    @Test
    void otherIoFailureStillReturnsServerErrorBody() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/attachments/1");

        Object result = new GlobalExceptionHandler()
                .handleIo(new java.io.IOException("磁盘读取失败"), request, new MockHttpServletResponse());

        assertTrue(result instanceof ResponseEntity);
        ResponseEntity<?> response = (ResponseEntity<?>) result;
        assertEquals(500, response.getStatusCodeValue());
        assertEquals(500, ((ApiResult<?>) response.getBody()).getCode());
        assertEquals(Boolean.TRUE, request.getAttribute(GlobalExceptionHandler.FAILED_ATTR));
    }
}
