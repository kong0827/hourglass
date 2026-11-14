package com.hourglass.service;

import com.hourglass.common.Nos;
import com.hourglass.common.Texts;
import com.hourglass.dto.BoardQuery;
import com.hourglass.dto.DemandPage;
import com.hourglass.dto.DemandQuery;
import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.SearchHit;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Task;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.TestCaseMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 全局搜索：复用各模块已有的可见范围与检索口径，只做聚合与截断。
 * 结果按 项目 → 工作项 → 文档 → 需求 → 用例 排列，每类最多 limit 条。
 */
@Service
public class SearchService {

    private final TaskQueryService taskQueryService;
    private final RequirementService requirementService;
    private final DemandService demandService;
    private final RequirementDocMapper docMapper;
    private final TestCaseMapper caseMapper;
    private final ProjectAccessService projectAccess;

    public SearchService(TaskQueryService taskQueryService,
                         RequirementService requirementService,
                         DemandService demandService,
                         RequirementDocMapper docMapper,
                         TestCaseMapper caseMapper,
                         ProjectAccessService projectAccess) {
        this.taskQueryService = taskQueryService;
        this.requirementService = requirementService;
        this.demandService = demandService;
        this.docMapper = docMapper;
        this.caseMapper = caseMapper;
        this.projectAccess = projectAccess;
    }

    public List<SearchHit> search(String workspaceId, String userId, String rawQuery, int limit) {
        String q = Texts.trimToNull(rawQuery);
        if (q == null) {
            return Collections.emptyList();
        }
        int per = Math.max(1, Math.min(limit, 10));
        String needle = q.toLowerCase();
        List<SearchHit> hits = new ArrayList<SearchHit>();

        List<ReqProgress> projects = requirementService.list(workspaceId, userId);
        Map<String, String> projectNames = new HashMap<String, String>();
        for (ReqProgress p : projects) {
            projectNames.put(p.getId(), p.getName());
        }
        for (ReqProgress p : projects) {
            if (hits.size() >= per) {
                break;
            }
            if (contains(p.getName(), needle) || contains(p.getDescription(), needle) || contains(p.getObjective(), needle)) {
                SearchHit h = new SearchHit();
                h.setType("project");
                h.setId(p.getId());
                h.setTitle(p.getName());
                h.setStatus(p.getStatus());
                h.setExtra(p.getArchivedAt() == null ? "项目" : "项目 · 已归档");
                h.setUpdatedAt(p.getUpdatedAt());
                hits.add(h);
            }
        }

        BoardQuery tq = new BoardQuery();
        tq.setQ(q);
        TaskListResponse tasks = taskQueryService.list(workspaceId, userId, tq, "updated", 0, per);
        for (Task t : tasks.getItems()) {
            SearchHit h = new SearchHit();
            h.setType("task");
            h.setId(t.getId());
            h.setTitle(t.getTitle());
            h.setReqId(t.getReqId());
            h.setReqName(projectNames.get(t.getReqId()));
            h.setStatus(t.getBoardColumn());
            h.setExtra(taskExtra(t));
            h.setUpdatedAt(t.getUpdatedAt());
            hits.add(h);
        }

        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        /* 文档草稿的可见口径与文档列表一致：仅作者本人与空间 owner/admin 能搜到 */
        boolean seeAllDrafts = ProjectAccessService.isPrivileged(projectAccess.roleOf(workspaceId, userId));
        hits.addAll(docMapper.searchVisible(workspaceId, viewerId, userId, seeAllDrafts, q, per));

        DemandQuery dq = new DemandQuery();
        dq.setQ(q);
        dq.setOffset(0);
        dq.setLimit(per);
        DemandPage demands = demandService.page(workspaceId, userId, dq);
        for (Demand d : demands.getItems()) {
            SearchHit h = new SearchHit();
            h.setType("demand");
            h.setId(d.getId());
            h.setTitle(d.getTitle());
            h.setReqId(d.getReqId());
            h.setReqName(projectNames.get(d.getReqId()));
            h.setStatus(d.getStatus());
            h.setExtra(d.getItemKind());
            h.setUpdatedAt(d.getUpdatedAt());
            hits.add(h);
        }

        hits.addAll(caseMapper.searchVisible(workspaceId, viewerId, q, per));

        Collections.sort(hits, new Comparator<SearchHit>() {
            @Override
            public int compare(SearchHit a, SearchHit b) {
                int byType = typeOrder(a.getType()) - typeOrder(b.getType());
                return byType != 0 ? byType : 0;
            }
        });
        return hits;
    }

    /** 按编号搜到时要能看出命中理由：编号排在负责人前；未取号保持原样 */
    private static String taskExtra(Task t) {
        String no = Nos.workItem(t.getItemNo());
        if (no.isEmpty()) {
            return t.getOwner();
        }
        String owner = Texts.trimToNull(t.getOwner());
        return owner == null ? no : no + " · " + owner;
    }

    private static int typeOrder(String type) {
        if ("project".equals(type)) return 0;
        if ("task".equals(type)) return 1;
        if ("doc".equals(type)) return 2;
        if ("demand".equals(type)) return 3;
        return 4;
    }

    private static boolean contains(String value, String lowerNeedle) {
        return value != null && value.toLowerCase().contains(lowerNeedle);
    }
}
