package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.ListPreferenceRequest;
import com.devstudio.kanban.dto.ListPreferenceResponse;
import com.devstudio.kanban.entity.UserListPreference;
import com.devstudio.kanban.mapper.UserListPreferenceMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Service
public class ListPreferenceService {

    public static final String TASK_LIST = "task-list";
    public static final String PROJECT_LIST = "project-list";
    public static final String PORTFOLIO = "portfolio";
    public static final String DEMAND_POOL = "demand-pool";
    public static final String PROJECT_VIEW = "project-view";

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> TASK_COLUMNS = Collections.unmodifiableSet(new LinkedHashSet<String>(Arrays.asList(
            "title", "column", "priority", "owner", "dueDate", "progress", "project", "version",
            "category", "startDate", "tags", "subtasks", "work", "comments", "updatedAt")));
    private static final Set<String> PROJECT_COLUMNS = Collections.unmodifiableSet(new LinkedHashSet<String>(Arrays.asList(
            "name", "status", "description", "taskCount", "doneCount", "progress", "docCount",
            "firstReleasedAt", "createdAt", "updatedAt")));
    private static final Set<String> PORTFOLIO_COLUMNS = Collections.unmodifiableSet(new LinkedHashSet<String>(Arrays.asList(
            "name", "status", "health", "total", "backlog", "doing", "done", "overdue", "blocked",
            "progress", "weekCompleted", "weekWorkMinutes", "members")));
    private static final Set<String> DEMAND_POOL_COLUMNS = Collections.unmodifiableSet(new LinkedHashSet<String>(Arrays.asList(
            "title", "kind", "priority", "status", "project", "version", "expectDate", "wsjf", "source", "createdAt")));
    private static final Set<String> PROJECT_VIEW_COLUMNS = Collections.unmodifiableSet(new LinkedHashSet<String>(Arrays.asList(
            "name", "status", "health", "total", "backlog", "doing", "done", "overdue",
            "progress", "owner", "dueDate", "estimate", "actual")));

    private final UserListPreferenceMapper preferenceMapper;

    public ListPreferenceService(UserListPreferenceMapper preferenceMapper) {
        this.preferenceMapper = preferenceMapper;
    }

    public ListPreferenceResponse get(String userId, String workspaceId, String viewKey) {
        allowedColumns(viewKey);
        UserListPreference saved = preferenceMapper.select(userId, workspaceId, viewKey);
        if (saved == null) {
            return new ListPreferenceResponse(viewKey, null, Collections.<String>emptyList());
        }
        return new ListPreferenceResponse(viewKey, saved.getViewMode(), readColumns(saved.getColumnsJson()));
    }

    @Transactional
    public ListPreferenceResponse save(String userId, String workspaceId, String viewKey,
                                       ListPreferenceRequest req) {
        Set<String> allowed = allowedColumns(viewKey);
        String viewMode = validateViewMode(viewKey, req.getViewMode());
        List<String> columns = validateColumns(viewKey, allowed, req.getColumns());

        UserListPreference preference = new UserListPreference();
        preference.setUserId(userId);
        preference.setWorkspaceId(workspaceId);
        preference.setViewKey(viewKey);
        preference.setViewMode(viewMode);
        preference.setColumnsJson(writeColumns(columns));
        preferenceMapper.upsert(preference);
        return new ListPreferenceResponse(viewKey, viewMode, new ArrayList<String>(columns));
    }

    private Set<String> allowedColumns(String viewKey) {
        if (TASK_LIST.equals(viewKey)) {
            return TASK_COLUMNS;
        }
        if (PROJECT_LIST.equals(viewKey)) {
            return PROJECT_COLUMNS;
        }
        if (PORTFOLIO.equals(viewKey)) {
            return PORTFOLIO_COLUMNS;
        }
        if (DEMAND_POOL.equals(viewKey)) {
            return DEMAND_POOL_COLUMNS;
        }
        if (PROJECT_VIEW.equals(viewKey)) {
            return PROJECT_VIEW_COLUMNS;
        }
        throw AppException.badRequest("不支持的列表视图：" + viewKey);
    }

    private String requiredColumn(String viewKey) {
        if (TASK_LIST.equals(viewKey) || DEMAND_POOL.equals(viewKey)) {
            return "title";
        }
        return "name";
    }

    private String validateViewMode(String viewKey, String viewMode) {
        if (TASK_LIST.equals(viewKey)) {
            if (!"table".equals(viewMode)) {
                throw AppException.badRequest("任务列表仅支持 table 模式");
            }
        } else if (DEMAND_POOL.equals(viewKey)) {
            if (!"board".equals(viewMode) && !"table".equals(viewMode)) {
                throw AppException.badRequest("需求池仅支持 board/table 模式");
            }
        } else if (PROJECT_VIEW.equals(viewKey)) {
            if (!"board".equals(viewMode) && !"drill".equals(viewMode)) {
                throw AppException.badRequest("项目总览仅支持 board/drill 模式");
            }
        } else if (!"card".equals(viewMode) && !"table".equals(viewMode)) {
            throw AppException.badRequest("项目列表仅支持 card/table 模式");
        }
        return viewMode;
    }

    private List<String> validateColumns(String viewKey, Set<String> allowed, List<String> columns) {
        String required = requiredColumn(viewKey);
        if (columns == null || columns.isEmpty()) {
            throw AppException.badRequest("显示列必须包含 " + required);
        }
        if (columns.size() > allowed.size()) {
            throw AppException.badRequest("显示列数量过多，最多 " + allowed.size() + " 列");
        }
        Set<String> seen = new HashSet<String>();
        for (String column : columns) {
            if (!allowed.contains(column)) {
                throw AppException.badRequest("未知显示列：" + column);
            }
            if (!seen.add(column)) {
                throw AppException.badRequest("显示列不能重复：" + column);
            }
        }
        if (!seen.contains(required)) {
            throw AppException.badRequest("显示列必须包含 " + required);
        }
        if (!required.equals(columns.get(0))) {
            throw AppException.badRequest(required + " 必须为第一列");
        }
        return columns;
    }

    private String writeColumns(List<String> columns) {
        try {
            return JSON.writeValueAsString(columns);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("显示列序列化失败", e);
        }
    }

    private List<String> readColumns(String columnsJson) {
        try {
            return JSON.readValue(columnsJson, new TypeReference<List<String>>() { });
        } catch (Exception e) {
            throw new IllegalStateException("显示列配置格式错误", e);
        }
    }
}
