package com.hourglass.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import javax.servlet.http.HttpServletRequest;

/**
 * 全局异常处理：HTTP 状态码与业务 code 对齐（400/403/404/409/500），响应体仍是 ApiResult。
 * 前端 api.js 会读取非 2xx 的 JSON 体并抛出 message；未登录仍由 Spring Security 返回 401。
 *
 * 注意（第九轮审查 #4）：ChangeBroadcastFilter 不能只看 response.getStatus() 判断
 * 请求是否成功；这里每个 handler 都在 request 上打 FAILED_ATTR 标记，过滤器据此跳过。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** 业务失败的请求标记：由 ChangeBroadcastFilter 读取 */
    public static final String FAILED_ATTR = "hourglass.bizFailed";

    private static void markFailed(HttpServletRequest request) {
        if (request != null) {
            request.setAttribute(FAILED_ATTR, Boolean.TRUE);
        }
    }

    @ExceptionHandler(AppException.class)
    public ResponseEntity<ApiResult<Void>> handleAppException(AppException e, HttpServletRequest request) {
        markFailed(request);
        int status = e.getCode() >= 400 && e.getCode() <= 599 ? e.getCode() : 400;
        return ResponseEntity.status(status).body(ApiResult.error(e.getCode(), e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResult<Void>> handleValidation(MethodArgumentNotValidException e, HttpServletRequest request) {
        markFailed(request);
        FieldError fieldError = e.getBindingResult().getFieldError();
        String message = fieldError == null ? "参数不合法" : fieldError.getDefaultMessage();
        return ResponseEntity.badRequest().body(ApiResult.error(400, message));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiResult<Void>> handleTypeMismatch(MethodArgumentTypeMismatchException e, HttpServletRequest request) {
        markFailed(request);
        return ResponseEntity.badRequest().body(ApiResult.error(400, "参数不合法：" + e.getName()));
    }

    @ExceptionHandler(org.springframework.web.bind.MissingServletRequestParameterException.class)
    public ResponseEntity<ApiResult<Void>> handleMissingParameter(
            org.springframework.web.bind.MissingServletRequestParameterException e, HttpServletRequest request) {
        markFailed(request);
        return ResponseEntity.badRequest().body(ApiResult.error(400, "缺少必要参数：" + e.getParameterName()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResult<Void>> handleUnreadable(HttpMessageNotReadableException e, HttpServletRequest request) {
        markFailed(request);
        return ResponseEntity.badRequest()
                .body(ApiResult.error(400, "请求体格式不正确（JSON 解析失败或日期格式非法）"));
    }

    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiResult<Void>> handleUploadTooLarge(
            org.springframework.web.multipart.MaxUploadSizeExceededException e, HttpServletRequest request) {
        markFailed(request);
        return ResponseEntity.badRequest().body(ApiResult.error(400, "文件不能超过 10MB"));
    }

    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResult<Void>> handleMethodNotSupported(
            org.springframework.web.HttpRequestMethodNotSupportedException e, HttpServletRequest request) {
        markFailed(request);
        log.warn("请求方法不支持：{} {}", request.getMethod(), request.getRequestURI());
        return ResponseEntity.status(405).body(ApiResult.error(405, "请求方法不支持"));
    }

    @ExceptionHandler(org.springframework.web.context.request.async.AsyncRequestTimeoutException.class)
    public void handleAsyncTimeout(HttpServletRequest request) {
        // SSE 到点断开属正常回收：响应已是 event-stream，不能再写 JSON 错误体，
        // 否则 HttpMessageNotWritableException 会把每次重连都刷成一条 ERROR。
        markFailed(request);
        log.debug("异步请求超时（SSE 正常断开）：{} {}", request.getMethod(), request.getRequestURI());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResult<Void>> handleOther(Exception e, HttpServletRequest request) {
        markFailed(request);
        log.error("未处理异常：{} {}", request.getMethod(), request.getRequestURI(), e);
        return ResponseEntity.status(500).body(ApiResult.error(500, "服务内部错误"));
    }
}
