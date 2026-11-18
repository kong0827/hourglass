package com.hourglass.dto;

import lombok.Data;

/**
 * 恢复已取消工作项：回到取消前所在列。
 *
 * <p>说明必填，写清为什么捡回来；恢复不动取消原因与取消时间，
 * 那三个字段只清空、不覆盖 —— 历史靠 task_log 追溯。
 */
@Data
public class TaskRestoreRequest {

    /** 恢复说明（必填，写清恢复依据） */
    private String note;
}
