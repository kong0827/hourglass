package com.hourglass.dto;

import lombok.Data;

/** 生成分享链接的可选项：有效期天数与是否允许复制/打印，省略时按 30 天、允许复制 */
@Data
public class ReqDocShareRequest {

    /** 有效期天数，接口限 1~365；前端提供 7 / 30 / 90 */
    private Integer days;
    /** 是否允许复制与打印 */
    private Boolean allowCopy;
}
