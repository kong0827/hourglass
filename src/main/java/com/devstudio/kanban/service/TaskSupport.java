package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.entity.BoardColumn;
import com.devstudio.kanban.entity.Tag;
import com.devstudio.kanban.entity.TagTaskRow;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.TagMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * BE-ARCH-1：TaskService 拆分后四个服务共用的小工具。
 *
 * <p>只放"跨服务口径必须一致"的东西：任务存在性判定、标签读写、看板列解析。
 * 业务编排一律留在 Query / Command / Workflow / Trash 四个服务里，避免又长回一个上帝类。
 */
@Component
class TaskSupport {

    private final TaskMapper taskMapper;
    private final TagMapper tagMapper;
    private final WorkspaceMetaCache metaCache;

    TaskSupport(TaskMapper taskMapper, TagMapper tagMapper, WorkspaceMetaCache metaCache) {
        this.taskMapper = taskMapper;
        this.tagMapper = tagMapper;
        this.metaCache = metaCache;
    }

    /** 任务存在性口径：统一区分"排除回收站 / 包含回收站 / 仅回收站"三种调用意图 */
    enum Deleted { EXCLUDE, INCLUDE, ONLY }

    Task require(String workspaceId, String taskId) {
        return require(workspaceId, taskId, Deleted.EXCLUDE);
    }

    Task requireIncludingDeleted(String workspaceId, String taskId) {
        return require(workspaceId, taskId, Deleted.INCLUDE);
    }

    Task requireDeleted(String workspaceId, String taskId) {
        return require(workspaceId, taskId, Deleted.ONLY);
    }

    Task require(String workspaceId, String taskId, Deleted deleted) {
        Task t = taskMapper.selectById(taskId);
        boolean inWorkspace = t != null && workspaceId.equals(t.getWorkspaceId());
        boolean isDeleted = inWorkspace && t.getDeletedAt() != null;
        boolean ok = inWorkspace && (deleted == Deleted.INCLUDE
                || (deleted == Deleted.EXCLUDE && !isDeleted)
                || (deleted == Deleted.ONLY && isDeleted));
        if (!ok) {
            throw AppException.notFound(deleted == Deleted.ONLY
                    ? "回收站中没有该任务：" + taskId : "任务不存在：" + taskId);
        }
        return t;
    }

    List<String> tagNames(String workspaceId, String taskId) {
        List<String> names = new ArrayList<String>();
        List<TagTaskRow> rows = tagMapper.selectByTaskIds(workspaceId, Collections.singletonList(taskId));
        for (TagTaskRow row : rows) {
            names.add(row.getName());
        }
        return names;
    }

    void saveTags(String workspaceId, String taskId, List<String> names) {
        tagMapper.deleteTaskTags(workspaceId, taskId);
        /* 标签及关联计数变了：清缓存，下一次看板/联想重新查库 */
        evictTagMeta(workspaceId);
        if (names == null) {
            return;
        }
        Set<String> seen = new HashSet<String>();
        int count = 0;
        for (String raw : names) {
            String name = Texts.trimToNull(raw);
            if (name == null) {
                continue;
            }
            // 标签名不允许含逗号（前端用逗号分隔），替换为空格
            name = name.replace(',', ' ').replace('，', ' ').trim();
            if (name.isEmpty()) {
                continue;
            }
            name = Texts.cut(name, 16);
            if (!seen.add(name)) {
                continue;
            }
            if (++count > 8) {
                break;
            }
            Tag tag = tagMapper.selectByName(workspaceId, name);
            if (tag == null) {
                tag = new Tag();
                tag.setId(Ids.gen("T"));
                tag.setWorkspaceId(workspaceId);
                tag.setName(name);
                try {
                    tagMapper.insert(tag);
                } catch (Exception e) {
                    tag = tagMapper.selectByName(workspaceId, name);
                }
                if (tag == null) {
                    continue;
                }
            }
            tagMapper.insertTaskTag(taskId, tag.getId(), workspaceId);
        }
    }

    private void evictTagMeta(String workspaceId) {
        metaCache.evictTags(workspaceId);
        CacheSync.evictAfterCommitOrNow(() -> metaCache.evictTags(workspaceId));
    }

    void validateColumn(String workspaceId, String column) {
        if (Consts.COL_DONE.equals(column)) {
            return;
        }
        if (metaCache.column(workspaceId, column) == null) {
            throw AppException.badRequest("看板列不存在或已被删除");
        }
    }

    boolean columnExists(String workspaceId, String column) {
        if (column == null) {
            return false;
        }
        if (Consts.COL_BACKLOG.equals(column) || Consts.COL_DOING.equals(column) || Consts.COL_DONE.equals(column)) {
            return true;
        }
        return metaCache.column(workspaceId, column) != null;
    }

    String firstOpenColumn(String workspaceId) {
        for (BoardColumn c : metaCache.columns(workspaceId)) {
            if (!Consts.COL_DONE.equals(c.getId())) {
                return c.getId();
            }
        }
        return Consts.COL_BACKLOG;
    }

    String columnName(String workspaceId, String column) {
        if (Consts.COL_DONE.equals(column)) {
            return "已完成";
        }
        BoardColumn c = metaCache.column(workspaceId, column);
        return c == null ? column : c.getName();
    }
}
