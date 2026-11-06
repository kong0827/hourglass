package com.devstudio.kanban.dto;

import lombok.Data;

/** 发布/收回发布请求 */
@Data
public class ReqDocPublishRequest {

    /** true = 发布（成员可见）；false = 收回发布（转草稿） */
    private Boolean published;
}
