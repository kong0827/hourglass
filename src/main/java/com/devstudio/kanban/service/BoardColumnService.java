package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.common.Ids;
import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.dto.ColumnRequest;
import com.devstudio.kanban.entity.BoardColumn;
import com.devstudio.kanban.entity.Task;
import com.devstudio.kanban.mapper.BoardColumnMapper;
import com.devstudio.kanban.mapper.TaskMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

@Service
public class BoardColumnService {

    private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final String DEFAULT_COLOR = "#8a8578";

    private final BoardColumnMapper boardColumnMapper;
    private final TaskMapper taskMapper;
    private final ActivityService activityService;
    /** 列定义缓存：读列表/查名/排序校验共用，写入口负责失效 */
    private final WorkspaceMetaCache metaCache;

    public BoardColumnService(BoardColumnMapper boardColumnMapper, TaskMapper taskMapper,
                              ActivityService activityService, WorkspaceMetaCache metaCache) {
        this.boardColumnMapper = boardColumnMapper;
        this.taskMapper = taskMapper;
        this.activityService = activityService;
        this.metaCache = metaCache;
    }

    public List<BoardColumn> list(String workspaceId) {
        return metaCache.columns(workspaceId);
    }

    @Transactional
    public BoardColumn create(String workspaceId, ColumnRequest req) {
        String name = req.getName().trim();
        checkName(workspaceId, name, null);
        BoardColumn c = new BoardColumn();
        c.setId(Ids.gen("C"));
        c.setWorkspaceId(workspaceId);
        c.setName(Texts.cut(name, 12));
        c.setColor(normalizeColor(req.getColor()));
        c.setSortOrder(boardColumnMapper.maxSortOrder(workspaceId) + 1);
        boardColumnMapper.insert(c);
        evictColumns(workspaceId);
        return boardColumnMapper.selectById(workspaceId, c.getId());
    }

    @Transactional
    public BoardColumn update(String workspaceId, String id, ColumnRequest req) {
        BoardColumn c = boardColumnMapper.selectById(workspaceId, id);
        if (c == null) {
            throw AppException.notFound("看板列不存在：" + id);
        }
        String name = req.getName().trim();
        checkName(workspaceId, name, id);
        c.setName(Texts.cut(name, 12));
        c.setColor(normalizeColor(req.getColor()));
        boardColumnMapper.update(c);
        evictColumns(workspaceId);
        return boardColumnMapper.selectById(workspaceId, id);
    }

    /** 删除列：任务移入最靠前的其他列（backlog/doing 为内置列不可删） */
    @Transactional
    public void delete(String workspaceId, String id) {
        BoardColumn c = boardColumnMapper.selectById(workspaceId, id);
        if (c == null) {
            throw AppException.notFound("看板列不存在：" + id);
        }
        if (Consts.COL_BACKLOG.equals(id) || Consts.COL_DOING.equals(id)) {
            throw AppException.badRequest("「待处理」「进行中」为内置列，不可删除（可改名）");
        }
        String target = null;
        String targetName = null;
        for (BoardColumn other : metaCache.columns(workspaceId)) {
            if (!other.getId().equals(id)) {
                target = other.getId();
                targetName = other.getName();
                break;
            }
        }
        if (target == null) {
            throw AppException.badRequest("至少需要保留一个看板列");
        }
        boardColumnMapper.moveTasks(workspaceId, id, target);
        boardColumnMapper.deleteById(workspaceId, id);
        renumber(workspaceId, target);
        evictColumns(workspaceId);
        /* O-9：破坏性配置变更留审计（活动流可见）
           第九轮审查 #9：文案写列名而不是列 ID，否则活动流里会出现「C1a2b3c4」这种不可读内容 */
        activityService.logConfig(workspaceId,
                "删除看板列「" + c.getName() + "」，其下任务已移入「"
                        + (targetName == null ? target : targetName) + "」");
    }

    @Transactional
    public void order(String workspaceId, List<String> ids) {
        Set<String> known = new HashSet<String>();
        for (BoardColumn c : metaCache.columns(workspaceId)) {
            known.add(c.getId());
        }
        Set<String> unique = new HashSet<String>(ids);
        if (unique.size() != ids.size() || ids.size() != known.size() || !known.containsAll(ids)) {
            throw AppException.badRequest("排序列表与现有看板列不一致");
        }
        for (int i = 0; i < ids.size(); i++) {
            boardColumnMapper.updateSortOrder(workspaceId, ids.get(i), i);
        }
        evictColumns(workspaceId);
    }

    private void renumber(String workspaceId, String columnId) {
        List<Task> tasks = new ArrayList<Task>();
        for (Task t : taskMapper.selectAll(workspaceId)) {
            if (columnId.equals(t.getBoardColumn())) {
                tasks.add(t);
            }
        }
        for (int i = 0; i < tasks.size(); i++) {
            taskMapper.updateSortOrder(tasks.get(i).getId(), i);
        }
    }

    private void checkName(String workspaceId, String name, String selfId) {
        if ("已完成".equals(name)) {
            throw AppException.badRequest("「已完成」是系统保留列名");
        }
        for (BoardColumn c : metaCache.columns(workspaceId)) {
            if (name.equals(c.getName()) && !c.getId().equals(selfId)) {
                throw AppException.badRequest("已存在同名看板列：" + name);
            }
        }
    }

    private void evictColumns(String workspaceId) {
        /* 事务内先清一次（本请求后续读取也是最新值），提交后再清一次，
           防止提交前的并发读把旧列表重新装回缓存 */
        metaCache.evictColumns(workspaceId);
        CacheSync.evictAfterCommitOrNow(() -> metaCache.evictColumns(workspaceId));
    }

    private String normalizeColor(String color) {
        String c = Texts.trimToNull(color);
        return c != null && COLOR.matcher(c).matches() ? c : DEFAULT_COLOR;
    }
}
