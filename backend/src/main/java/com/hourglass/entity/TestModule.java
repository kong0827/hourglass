package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 项目测试模块：模板预置或手动维护，用例的 module 仍以自由文本落库。 */
@Data
public class TestModule {

    private String id;
    private String workspaceId;
    private String reqId;
    private String name;
    private Integer sortOrder;
    private LocalDateTime createdAt;
}
