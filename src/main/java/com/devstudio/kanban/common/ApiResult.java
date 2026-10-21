package com.devstudio.kanban.common;

import lombok.Getter;

/**
 * 统一接口返回：code=0 成功，非 0 为业务错误码（HTTP 仍为 200，鉴权失败除外）
 */
@Getter
public class ApiResult<T> {

    private final int code;
    private final String message;
    private final T data;

    private ApiResult(int code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    public static <T> ApiResult<T> ok(T data) {
        return new ApiResult<T>(0, "ok", data);
    }

    public static ApiResult<Void> ok() {
        return new ApiResult<Void>(0, "ok", null);
    }

    public static <T> ApiResult<T> error(int code, String message) {
        return new ApiResult<T>(code, message, null);
    }
}
