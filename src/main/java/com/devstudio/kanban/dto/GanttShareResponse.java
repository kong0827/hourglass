package com.devstudio.kanban.dto;

import com.devstudio.kanban.entity.TaskDependency;
import com.devstudio.kanban.entity.WorkspacePriority;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 公开只读分享：任务用白名单 DTO，避免实体新增字段被动泄露 */
@Data
public class GanttShareResponse {

    private String workspaceId;
    private String workspaceName;
    private LocalDateTime generatedAt;
    private LocalDateTime baselineAt;
    private List<PublicGanttTask> tasks = new ArrayList<PublicGanttTask>();
    private List<WorkspacePriority> priorities = new ArrayList<WorkspacePriority>();
    private List<TaskDependency> deps = new ArrayList<TaskDependency>();
    private Map<String, GanttResponse.BaselinePoint> baseline = new LinkedHashMap<String, GanttResponse.BaselinePoint>();
}
