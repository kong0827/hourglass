package com.devstudio.kanban.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 某任务计时的时间边界（首次开始 / 最后结束），用于完成快照。 */
@Data
public class TimeBounds {
    private LocalDateTime firstStartedAt;
    private LocalDateTime lastEndedAt;
}
