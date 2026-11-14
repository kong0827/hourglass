package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Tag;
import com.hourglass.entity.TagTaskRow;
import com.hourglass.entity.Task;
import com.hourglass.mapper.TagMapper;
import com.hourglass.mapper.TaskMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
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

    private static final Logger log = LoggerFactory.getLogger(TaskSupport.class);

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

    /**
     * 分配项目内编号后插入（sql/82）。并发建工作项会抢到同一个号，由唯一键 uk_task_item_no 拒绝，
     * 这里重算重试；失败的 INSERT 不会让 InnoDB 事务失效（与用例编号 TC-001 同一口径）。
     * 静态 + 显式传 mapper：调用方仍直接持有写入动作，隔离 TaskSupport 的测试不会连插入一起屏蔽掉。
     */
    static void insertWithNo(TaskMapper mapper, Task t) {
        for (int attempt = 0; attempt < 3; attempt++) {
            t.setItemNo(mapper.selectNextItemNo(t.getWorkspaceId(), t.getReqId()));
            try {
                mapper.insert(t);
                return;
            } catch (DuplicateKeyException e) {
                if (!numberConflict(e)) {
                    throw e;
                }
                log.warn("工作项编号并发冲突，重试第 {} 次：project={}", attempt + 2, t.getReqId());
            }
        }
        throw AppException.badRequest("工作项编号生成冲突，请重试");
    }

    /** 换项目 / 存量未取号：重新取号后更新，返回受影响行数（调用方据此做 CAS 判定） */
    static int updateWithNo(TaskMapper mapper, Task t) {
        for (int attempt = 0; attempt < 3; attempt++) {
            t.setItemNo(mapper.selectNextItemNo(t.getWorkspaceId(), t.getReqId()));
            try {
                return mapper.update(t);
            } catch (DuplicateKeyException e) {
                if (!numberConflict(e)) {
                    throw e;
                }
                log.warn("工作项换项目编号冲突，重试第 {} 次：project={}", attempt + 2, t.getReqId());
            }
        }
        throw AppException.badRequest("工作项编号生成冲突，请重试");
    }

    /**
     * 只重试编号撞键。工作项 ID 可由客户端指定，主键撞键是另一回事，
     * 若一并重试会把「ID 已被占用」误报成编号冲突。
     */
    private static boolean numberConflict(DuplicateKeyException e) {
        String message = e.getMessage();
        return message != null && message.contains("uk_task_item_no");
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
            throw AppException.badRequest("看板列不存在：" + column);
        }
    }

    boolean columnExists(String workspaceId, String column) {
        if (column == null) {
            return false;
        }
        if (Consts.COL_BACKLOG.equals(column) || Consts.COL_DOING.equals(column)
                || Consts.COL_TEST.equals(column) || Consts.COL_TESTING.equals(column)
                || Consts.COL_DONE.equals(column)) {
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

    /** 列的有效处理规则：待处理/进行中/已完成固定，待测试/测试中与自定义列读库 */
    String processingRule(String workspaceId, String column) {
        if (Consts.COL_BACKLOG.equals(column)) {
            return "backlog";
        }
        if (Consts.COL_DOING.equals(column)) {
            return "normal";
        }
        if (Consts.COL_DONE.equals(column)) {
            return "done";
        }
        BoardColumn c = metaCache.column(workspaceId, column);
        String rule = c == null ? null : c.getProcessingRule();
        return rule == null ? "normal" : rule;
    }

    /** 当前列是否允许运行计时：只有「正常处理」列可计时 */
    boolean canTime(String workspaceId, String column) {
        return "normal".equals(processingRule(workspaceId, column));
    }

    /** 当前列是否计入执行逾期：正常处理 / 等待接续 / 待处理都计，执行结束 / 已完成不计 */
    boolean countsOverdue(String workspaceId, String column) {
        String rule = processingRule(workspaceId, column);
        return "normal".equals(rule) || "waiting".equals(rule) || "backlog".equals(rule);
    }
}
