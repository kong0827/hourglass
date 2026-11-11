package com.hourglass.common;

import lombok.Getter;

/**
 * 业务异常：由 GlobalExceptionHandler 统一转为 ApiResult
 */
@Getter
public class AppException extends RuntimeException {

    private final int code;

    public AppException(int code, String message) {
        super(message);
        this.code = code;
    }

    public AppException(int code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public static AppException badRequest(String message) {
        return new AppException(400, message);
    }

    public static AppException notFound(String message) {
        return new AppException(404, message);
    }

    public static AppException conflict(String message) {
        return new AppException(409, message);
    }
}
