package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 项目测试模块目录：不限层级（仅防环），用例通过 module_id 单归属挂载，module 文本是节点名快照。 */
@Data
public class TestModule {

    private String id;
    private String workspaceId;
    private String reqId;
    /** 父目录 ID，空串 = 顶级 */
    private String parentId;
    private String name;
    private Integer sortOrder;
    private LocalDateTime createdAt;
}
