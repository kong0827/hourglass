package com.devstudio.kanban.dto;

import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.entity.TaskDependency;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 公开只读分享：不含描述、备注、提醒、附件等敏感字段 */
@Data
public class GanttShareResponse {

    private String workspaceName;
    private LocalDateTime generatedAt;
    private LocalDateTime baselineAt;
    private List<Task> tasks = new ArrayList<Task>();
    private List<TaskDependency> deps = new ArrayList<TaskDependency>();
    private Map<String, GanttResponse.BaselinePoint> baseline = new LinkedHashMap<String, GanttResponse.BaselinePoint>();
}
