package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 任务关注人列表项：姓名由服务端联查，前端不再逐人取成员。 */
@Data
public class TaskWatcherView {

    private String userId;
    private String userName;
    private LocalDateTime createdAt;
}
