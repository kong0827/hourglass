package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 需求关注人列表项：姓名与添加人由服务端联查，前端不再逐人取成员。 */
@Data
public class DemandWatcherView {

    private String userId;
    private String userName;
    private String addedBy;
    private String addedByName;
    private LocalDateTime createdAt;
}
