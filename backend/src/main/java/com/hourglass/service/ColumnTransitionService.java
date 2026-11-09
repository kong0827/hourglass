package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Consts;
import com.hourglass.common.Texts;
import com.hourglass.dto.BoardResponse;
import com.hourglass.dto.ColumnTransitionView;
import com.hourglass.entity.BoardColumn;
import com.hourglass.entity.ColumnTransition;
import com.hourglass.mapper.ColumnTransitionMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 看板列状态流转规则：每空间一份「来源列 → 目标列」三态矩阵。
 *
 * <p>只存显式配置过的格子，没有记录即按默认：已完成 → 非已完成 = 需填原因，
 * 其余 = 允许。移动入口统一调用 {@link #check}，避免拖拽/批量/抽屉口径不一致。</p>
 */
@Service
public class ColumnTransitionService {

    public static final String RULE_ALLOW = "allow";
    public static final String RULE_REASON = "reason";
    public static final String RULE_DENY = "deny";

    /** 原因写进移动日志（detail 上限 255 字），留足列名前缀 */
    private static final int REASON_MAX = 120;

    private final ColumnTransitionMapper mapper;
    private final BoardColumnService columnService;
    private final WorkspaceMetaCache metaCache;

    public ColumnTransitionService(ColumnTransitionMapper mapper, BoardColumnService columnService,
                                   WorkspaceMetaCache metaCache) {
        this.mapper = mapper;
        this.columnService = columnService;
        this.metaCache = metaCache;
    }

    /** 设置页矩阵：全部列 + 生效规则（含默认值） */
    public ColumnTransitionView view(String workspaceId) {
        List<BoardResponse.ColumnDef> columns = columns(workspaceId);
        Map<String, String> explicit = explicitRules(workspaceId);
        ColumnTransitionView view = new ColumnTransitionView();
        view.setColumns(columns);
        for (BoardResponse.ColumnDef from : columns) {
            for (BoardResponse.ColumnDef to : columns) {
                if (from.getId().equals(to.getId())) {
                    continue;
                }
                view.getRules().add(new ColumnTransitionView.Rule(from.getId(), to.getId(),
                        resolve(explicit, from.getId(), to.getId())));
            }
        }
        return view;
    }

    /** 保存单个格子；allow 也落库，便于以后调整默认值时保留用户选择 */
    @Transactional
    public void save(String workspaceId, String from, String to, String rule) {
        Set<String> known = columnIds(workspaceId);
        if (!known.contains(from) || !known.contains(to)) {
            throw AppException.badRequest("看板列不存在，请刷新后重试");
        }
        if (from.equals(to)) {
            throw AppException.badRequest("同列内是排序，不需要配置流转规则");
        }
        if (!RULE_ALLOW.equals(rule) && !RULE_REASON.equals(rule) && !RULE_DENY.equals(rule)) {
            throw AppException.badRequest("流转规则只能是 allow / reason / deny");
        }
        ColumnTransition t = new ColumnTransition();
        t.setWorkspaceId(workspaceId);
        t.setFromColumn(from);
        t.setToColumn(to);
        t.setRule(rule);
        mapper.upsert(t);
        evict(workspaceId);
    }

    /** 恢复默认：删除全部显式配置（已完成 → 其他列回到「需填原因」） */
    @Transactional
    public void reset(String workspaceId) {
        mapper.deleteAllByWorkspace(workspaceId);
        evict(workspaceId);
    }

    /** 删除看板列时清理与之相关的规则，未配置过的格子不受影响 */
    @Transactional
    public void deleteByColumn(String workspaceId, String columnId) {
        mapper.deleteByColumn(workspaceId, columnId);
        evict(workspaceId);
    }

    /**
     * 移动校验：禁止直接拒绝，需填原因时必须给出原因。
     *
     * @param canForce 当前操作人是否空间主/管理员；force 只有在该值为 true 时才能越过规则
     */
    public Decision check(String workspaceId, String from, String to, String reason,
                          boolean force, boolean canForce) {
        String cleaned = Texts.cut(Texts.trimToNull(reason), REASON_MAX);
        if (from == null || to == null || from.equals(to)) {
            return new Decision(RULE_ALLOW, cleaned, false);
        }
        String rule = effectiveRule(workspaceId, from, to);
        if (RULE_DENY.equals(rule)) {
            if (force && canForce) {
                return new Decision(rule, cleaned, true);
            }
            if (force) {
                throw new AppException(403, "仅空间主或管理员可强制移动");
            }
            throw new AppException(422, denyMessage(workspaceId, from, to));
        }
        if (RULE_REASON.equals(rule)) {
            if (force) {
                if (canForce) {
                    return new Decision(rule, cleaned, true);
                }
                throw new AppException(403, "仅空间主或管理员可强制移动");
            }
            if (cleaned == null) {
                throw new AppException(412, "从「" + columnName(workspaceId, from) + "」移到「"
                        + columnName(workspaceId, to) + "」需要填写原因");
            }
        }
        return new Decision(rule, cleaned, false);
    }

    public String effectiveRule(String workspaceId, String from, String to) {
        return resolve(explicitRules(workspaceId), from, to);
    }

    private Map<String, String> explicitRules(String workspaceId) {
        Map<String, String> map = new HashMap<String, String>();
        for (ColumnTransition t : metaCache.transitions(workspaceId)) {
            map.put(key(t.getFromColumn(), t.getToColumn()), t.getRule());
        }
        return map;
    }

    private static String resolve(Map<String, String> explicit, String from, String to) {
        String rule = explicit.get(key(from, to));
        if (RULE_REASON.equals(rule) || RULE_DENY.equals(rule) || RULE_ALLOW.equals(rule)) {
            return rule;
        }
        return defaultRule(from, to);
    }

    /** 默认只收紧「已完成」的重开，其余全部允许 */
    public static String defaultRule(String from, String to) {
        return Consts.COL_DONE.equals(from) && !Consts.COL_DONE.equals(to) ? RULE_REASON : RULE_ALLOW;
    }

    private static String key(String from, String to) {
        return from + "\u0000" + to;
    }

    private List<BoardResponse.ColumnDef> columns(String workspaceId) {
        List<BoardResponse.ColumnDef> defs = new ArrayList<BoardResponse.ColumnDef>();
        for (BoardColumn c : columnService.list(workspaceId)) {
            String rule = Consts.COL_BACKLOG.equals(c.getId()) ? "backlog"
                    : Consts.COL_DOING.equals(c.getId()) ? "normal"
                    : (c.getProcessingRule() == null ? "normal" : c.getProcessingRule());
            defs.add(new BoardResponse.ColumnDef(c.getId(), c.getName(), c.getColor(), rule, false));
        }
        defs.add(new BoardResponse.ColumnDef(Consts.COL_DONE, "已完成", "#5f7a4a", "done", true));
        return defs;
    }

    private Set<String> columnIds(String workspaceId) {
        Set<String> ids = new HashSet<String>();
        for (BoardResponse.ColumnDef c : columns(workspaceId)) {
            ids.add(c.getId());
        }
        return ids;
    }

    private String columnName(String workspaceId, String id) {
        for (BoardResponse.ColumnDef c : columns(workspaceId)) {
            if (c.getId().equals(id)) {
                return c.getName();
            }
        }
        return id;
    }

    /** 禁止提示里给一个两跳可达的中间列，避免用户只看到“拖不过去” */
    private String denyMessage(String workspaceId, String from, String to) {
        List<BoardResponse.ColumnDef> columns = columns(workspaceId);
        String fromName = from;
        String toName = to;
        for (BoardResponse.ColumnDef c : columns) {
            if (c.getId().equals(from)) {
                fromName = c.getName();
            }
            if (c.getId().equals(to)) {
                toName = c.getName();
            }
        }
        String base = "不能从「" + fromName + "」直接到「" + toName + "」";
        Map<String, String> explicit = explicitRules(workspaceId);
        for (BoardResponse.ColumnDef mid : columns) {
            if (mid.getId().equals(from) || mid.getId().equals(to)) {
                continue;
            }
            if (!RULE_DENY.equals(resolve(explicit, from, mid.getId()))
                    && !RULE_DENY.equals(resolve(explicit, mid.getId(), to))) {
                return base + "，请先移到「" + mid.getName() + "」";
            }
        }
        return base + "，请按流程逐步推进";
    }

    private void evict(String workspaceId) {
        metaCache.evictTransitions(workspaceId);
        CacheSync.evictAfterCommitOrNow(() -> metaCache.evictTransitions(workspaceId));
    }

    /** 一次移动的判定结果；forced=true 表示空间主/管理员越过了规则 */
    public static class Decision {
        private final String rule;
        private final String reason;
        private final boolean forced;

        Decision(String rule, String reason, boolean forced) {
            this.rule = rule;
            this.reason = reason;
            this.forced = forced;
        }

        public String getRule() {
            return rule;
        }

        public String getReason() {
            return reason;
        }

        public boolean isForced() {
            return forced;
        }
    }
}
