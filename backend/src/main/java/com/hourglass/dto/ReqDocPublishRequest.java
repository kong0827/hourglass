package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotNull;

/** 发布/收回发布请求 */
@Data
public class ReqDocPublishRequest {

    /** true = 发布（成员可见）；false = 收回发布（转草稿） */
    @NotNull(message = "发布状态不能为空")
    private Boolean published;
}
