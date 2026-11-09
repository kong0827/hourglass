package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.entity.Task;
import com.hourglass.mapper.ReleaseMapper;
import org.springframework.stereotype.Service;

import java.util.SortedSet;
import java.util.TreeSet;

@Service
public class DeliveryScopeLock {
    private final ReleaseMapper mapper;

    public DeliveryScopeLock(ReleaseMapper mapper) {
        this.mapper = mapper;
    }

    // 同项目的排期、任务范围与发布共用行锁，避免预览确认和改绑交错。
    public void lockProjects(String workspaceId, String... projectIds) {
        SortedSet<String> ids = new TreeSet<String>();
        for (String id : projectIds) {
            if (id != null && !id.isEmpty()) {
                ids.add(id);
            }
        }
        for (String id : ids) {
            if (mapper.lockProject(workspaceId, id) == null) {
                throw AppException.notFound("项目不存在或已被删除");
            }
        }
    }

    public Task lockTask(String workspaceId, String taskId) {
        Task task = mapper.selectTaskForUpdate(workspaceId, taskId);
        if (task == null) {
            throw AppException.notFound("任务不存在");
        }
        return task;
    }
}
