package com.hourglass.dto;

import lombok.Data;

/** Internal relation row, never a task API representation. */
@Data
public class TaskVersionBinding {
    private String taskId;
    private String versionId;
    private String versionName;
}
