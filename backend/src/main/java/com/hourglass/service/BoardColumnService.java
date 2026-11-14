package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.Ids;
import com.hourglass.common.Texts;
import com.hourglass.dto.ColumnRequest;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.Task;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.ColumnTransitionMapper;
import com.hourglass.mapper.TaskMapper;
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
    private static final String RULE_NORMAL = "normal";
    private static final String RULE_WAITING = "waiting";
    private static final String RULE_ENDED = "ended";

    private final BoardColumnMapper boardColumnMapper;
    private final ColumnTransitionMapper transitionMapper;
    private final TaskMapper taskMapper;
    private final ActivityService activityService;
    /** 删列会批量改任务所在列：为受影响任务补时间线，避免看板列突然变化无可解释 */
    private final DeletionTraceService deletionTrace;
    /** 列定义缓存：读列表/查名/排序校验共用，写入口负责失效 */
    private final WorkspaceMetaCache metaCache;

    public BoardColumnService(BoardColumnMapper boardColumnMapper, ColumnTransitionMapper transitionMapper,
                              TaskMapper taskMapper, ActivityService activityService,
                              DeletionTraceService deletionTrace, WorkspaceMetaCache metaCache) {
        this.boardColumnMapper = boardColumnMapper;
        this.transitionMapper = transitionMapper;
        this.taskMapper = taskMapper;
        this.activityService = activityService;
        this.deletionTrace = deletionTrace;
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
        c.setProcessingRule(normalizeProcessingRule(req.getProcessingRule()));
        c.setSortOrder(boardColumnMapper.maxSortOrder(workspaceId) + 1);
        boardColumnMapper.insert(c);
        evictColumns(workspaceId);
        activityService.logConfig(workspaceId, "新建看板列「" + c.getName() + "」");
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
        String oldName = c.getName();
        String oldColor = c.getColor();
        String oldRule = c.getProcessingRule();
        c.setName(Texts.cut(name, 12));
        c.setColor(normalizeColor(req.getColor()));
        /* 待处理/进行中是固定语义，只允许改名改色，库里始终保持 normal；
           其余列仅在请求显式带 processingRule 时修改，看板改列名/改色不会把测试列规则冲掉 */
        if (isRuleFixed(id)) {
            c.setProcessingRule(RULE_NORMAL);
        } else {
            String rule = Texts.trimToNull(req.getProcessingRule());
            if (rule != null) {
                c.setProcessingRule(normalizeProcessingRule(rule));
            }
        }
        boardColumnMapper.update(c);
        evictColumns(workspaceId);
        StringBuilder changed = new StringBuilder();
        if (!oldName.equals(c.getName())) {
            changed.append("名称「").append(oldName).append("」→「").append(c.getName()).append("」");
        }
        if (!equal(oldColor, c.getColor())) {
            if (changed.length() > 0) {
                changed.append("、");
            }
            changed.append("颜色 ").append(oldColor == null ? "默认" : oldColor)
                    .append(" → ").append(c.getColor() == null ? "默认" : c.getColor());
        }
        if (!equal(oldRule, c.getProcessingRule())) {
            if (changed.length() > 0) {
                changed.append("、");
            }
            changed.append("计时规则「").append(ruleLabel(oldRule))
                    .append("」→「").append(ruleLabel(c.getProcessingRule())).append("」");
        }
        if (changed.length() > 0) {
            activityService.logConfig(workspaceId, "修改看板列「" + c.getName() + "」：" + changed);
        }
        return boardColumnMapper.selectById(workspaceId, id);
    }

    /** 删除列：任务移入最靠前的其他列（五个系统列均不可删） */
    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        if (Consts.COL_DONE.equals(id)) {
            throw AppException.badRequest("「已完成」是系统列，不可删除");
        }
        BoardColumn c = boardColumnMapper.selectById(workspaceId, id);
        if (c == null) {
            throw AppException.notFound("看板列不存在：" + id);
        }
        if (isBuiltIn(id)) {
            throw AppException.badRequest("「待处理」「进行中」「待测试」「测试中」为内置列，不可删除（可改名）");
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
        java.util.List<String> affectedTaskIds = taskMapper.selectIdsByColumnForCascade(workspaceId, id);
        boardColumnMapper.moveTasks(workspaceId, id, target);
        boardColumnMapper.deleteById(workspaceId, id);
        deletionTrace.logTaskCascade(workspaceId, userId, affectedTaskIds,
                "因删除看板列「" + c.getName() + "」，自动移入「"
                        + (targetName == null ? target : targetName) + "」");
        transitionMapper.deleteByColumn(workspaceId, id);
        renumber(workspaceId, target);
        evictColumns(workspaceId);
        metaCache.evictTransitions(workspaceId);
        CacheSync.evictAfterCommitOrNow(() -> metaCache.evictTransitions(workspaceId));
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
        List<String> names = new ArrayList<String>();
        for (BoardColumn c : metaCache.columns(workspaceId)) {
            names.add(c.getName());
        }
        activityService.logConfig(workspaceId, "调整看板列顺序：" + String.join(" › ", names));
    }

    private static boolean equal(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    private static String ruleLabel(String rule) {
        if (RULE_WAITING.equals(rule)) {
            return "不计时";
        }
        if (RULE_ENDED.equals(rule)) {
            return "结束计时";
        }
        return "正常计时";
    }

    private static boolean isBuiltIn(String id) {
        return Consts.COL_BACKLOG.equals(id) || Consts.COL_DOING.equals(id)
                || Consts.COL_TEST.equals(id) || Consts.COL_TESTING.equals(id);
    }

    /** 规则固定的系统列：待处理固定不计时，进行中固定正常计时 */
    private static boolean isRuleFixed(String id) {
        return Consts.COL_BACKLOG.equals(id) || Consts.COL_DOING.equals(id);
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

    public static String normalizeProcessingRule(String rule) {
        if (RULE_WAITING.equals(rule) || RULE_ENDED.equals(rule)) {
            return rule;
        }
        return RULE_NORMAL;
    }
}
