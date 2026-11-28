package com.hourglass.wecom;

/** 企微接口业务错误：errcode / errmsg 原样保留，便于判断 token 失效与成员不在通讯录。 */
public class WeComApiException extends RuntimeException {

    private final int errcode;

    public WeComApiException(int errcode, String errmsg) {
        super("企微接口失败（" + errcode + "）：" + errmsg);
        this.errcode = errcode;
    }

    public int getErrcode() {
        return errcode;
    }

    /** access_token 失效/过期，需要换 token 后重试 */
    public boolean tokenInvalid() {
        return errcode == 40014 || errcode == 42001 || errcode == 41001 || errcode == 40001;
    }
}