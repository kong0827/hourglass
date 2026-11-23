package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** 补记工时归属：某周某天归到某个项目或「内部 / 其他」。 */
@Data
public class CatchupTimeAlloc {

    private Long id;
    private String sessionId;
    /** req:<projectId> / unassigned */
    private String rowKey;
    private LocalDate day;
    private String reqId;
    private Integer minutes;
    private LocalDateTime createdAt;
}
