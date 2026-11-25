package com.hourglass.dto;

import lombok.Data;

/** 生成只读分享链接的参数；密码放请求体，避免出现在 URL 与访问日志里。 */
@Data
public class DeliveryShareRequest {

    private Boolean allowDownload;
    private Integer days;
    private String password;
    private String domains;
    private String watermark;
}
