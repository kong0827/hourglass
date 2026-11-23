package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 补记写入台账：提交时写了什么、写前是什么，5 分钟内撤销时按它精确回滚。 */
@Data
public class CatchupWrite {

    private Long id;
    private String sessionId;
    /** task_log 时间线 / blocked 阻塞字段 / time_alloc 工时归属 */
    private String writeType;
    private String refId;
    private String prevJson;
    private LocalDateTime createdAt;
}
