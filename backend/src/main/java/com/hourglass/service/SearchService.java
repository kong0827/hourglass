package com.hourglass.service;

import com.hourglass.common.Nos;
import com.hourglass.common.Texts;
import com.hourglass.dto.BoardQuery;
import com.hourglass.dto.DemandPage;
import com.hourglass.dto.DemandQuery;
import com.hourglass.dto.ReqProgress;
import com.hourglass.dto.SearchHit;
import com.hourglass.dto.SearchQuery;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.entity.Demand;
import com.hourglass.entity.Task;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.TestCaseMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
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
        SearchQuery query = new SearchQuery();
        query.setQ(rawQuery);
        query.setLimit(limit);
        return search(workspaceId, userId, query);
    }

    /**
     * 带范围的全局搜索：关键词可以为空，只给项目 / 版本 / 类型 / 状态 / 负责人 / 日期也行。
     * 每个实体只应用自己支持的维度，不支持的维度直接忽略。
     */
    public List<SearchHit> search(String workspaceId, String userId, SearchQuery raw) {
        SearchQuery query = normalize(raw);
        String q = Texts.trimToNull(query.getQ());
        if (q == null && !query.hasScope()) {
            return Collections.emptyList();
        }
        int per = Math.max(1, Math.min(query.getLimit(), 10));
        String needle = q == null ? null : q.toLowerCase();
        List<SearchHit> hits = new ArrayList<SearchHit>();

        List<ReqProgress> projects = requirementService.list(workspaceId, userId);
        Map<String, String> projectNames = new HashMap<String, String>();
        for (ReqProgress p : projects) {
            projectNames.put(p.getId(), p.getName());
        }
        if (wants(query, "project")) {
            hits.addAll(projectHits(projects, query, needle, per));
        }

        if (wants(query, "task")) {
            BoardQuery tq = new BoardQuery();
            tq.setQ(q);
            if (query.getReqId() != null) tq.getReqs().add(query.getReqId());
            if (query.getVersionId() != null) tq.getVersions().add(query.getVersionId());
            if (query.getStatus() != null) tq.getColumns().add(query.getStatus());
            if (query.getOwner() != null) tq.getOwners().add(query.getOwner());
            tq.setDueFrom(parseDate(query.getFrom()));
            tq.setDueTo(parseDate(query.getTo()));
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
        }

        String viewerId = projectAccess.viewerScope(workspaceId, userId);
        /* 文档草稿的可见口径与文档列表一致：仅作者本人与空间 owner/admin 能搜到 */
        boolean seeAllDrafts = ProjectAccessService.isPrivileged(projectAccess.roleOf(workspaceId, userId));
        if (wants(query, "doc")) {
            List<SearchHit> docHits = docMapper.searchFiltered(workspaceId, viewerId, userId, seeAllDrafts,
                    q, query.getReqId(), query.getStatus(), query.getOwner(),
                    query.getFrom(), query.getTo(), per);
            for (SearchHit h : docHits) {
                h.setSnippet(snippetAround(h.getSnippet(), q));
            }
            hits.addAll(docHits);
        }

        if (wants(query, "demand")) {
            DemandQuery dq = new DemandQuery();
            dq.setQ(q);
            dq.setReqId(query.getReqId());
            dq.setVersionId(query.getVersionId());
            dq.setStatus(query.getStatus());
            dq.setOwner(query.getOwner());
            dq.setExpectFrom(parseDate(query.getFrom()));
            dq.setExpectTo(parseDate(query.getTo()));
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
        }

        if (wants(query, "case")) {
            String caseStatus = "untested".equals(query.getStatus()) ? "__untested" : query.getStatus();
            List<SearchHit> caseHits = caseMapper.searchFiltered(workspaceId, viewerId, q, Nos.parseCase(q),
                    query.getReqId(), caseStatus, query.getOwner(), query.getFrom(), query.getTo(), per);
            for (SearchHit h : caseHits) {
                h.setExtra(caseExtra(h));
            }
            hits.addAll(caseHits);
        }

        Collections.sort(hits, new Comparator<SearchHit>() {
            @Override
            public int compare(SearchHit a, SearchHit b) {
                int byType = typeOrder(a.getType()) - typeOrder(b.getType());
                if (byType != 0) {
                    return byType;
                }
                /* 同类内按更新时间倒序，最近动过的先出现 */
                if (a.getUpdatedAt() == null && b.getUpdatedAt() == null) return 0;
                if (a.getUpdatedAt() == null) return 1;
                if (b.getUpdatedAt() == null) return -1;
                return b.getUpdatedAt().compareTo(a.getUpdatedAt());
            }
        });
        return hits;
    }

    /** 类型为空表示「全部」；指定类型后只查该类，避免无关查询。 */
    private static boolean wants(SearchQuery query, String type) {
        return query.getType() == null || type.equals(query.getType());
    }

    private static SearchQuery normalize(SearchQuery raw) {
        SearchQuery q = new SearchQuery();
        if (raw != null) {
            q.setQ(Texts.trimToNull(raw.getQ()));
            q.setType(oneOf(raw.getType(), "project", "task", "doc", "demand", "case"));
            q.setReqId(Texts.trimToNull(raw.getReqId()));
            q.setVersionId(Texts.trimToNull(raw.getVersionId()));
            q.setStatus(Texts.trimToNull(raw.getStatus()));
            q.setOwner(Texts.trimToNull(raw.getOwner()));
            q.setFrom(Texts.trimToNull(raw.getFrom()));
            q.setTo(Texts.trimToNull(raw.getTo()));
            q.setLimit(raw.getLimit());
        }
        /* 起止填反时按同一维度对调，避免得到空结果却看不出原因 */
        if (q.getFrom() != null && q.getTo() != null && q.getFrom().compareTo(q.getTo()) > 0) {
            String tmp = q.getFrom();
            q.setFrom(q.getTo());
            q.setTo(tmp);
        }
        return q;
    }

    private static String oneOf(String value, String... allowed) {
        String v = Texts.trimToNull(value);
        if (v == null) {
            return null;
        }
        for (String item : allowed) {
            if (item.equals(v)) {
                return v;
            }
        }
        return null;
    }

    private static LocalDate parseDate(String value) {
        String v = Texts.trimToNull(value);
        if (v == null) {
            return null;
        }
        try {
            return LocalDate.parse(v);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<SearchHit> projectHits(List<ReqProgress> projects, SearchQuery query,
                                               String needle, int per) {
        List<SearchHit> out = new ArrayList<SearchHit>();
        LocalDate from = parseDate(query.getFrom());
        LocalDate to = parseDate(query.getTo());
        for (ReqProgress p : projects) {
            if (out.size() >= per) {
                break;
            }
            if (needle != null && !contains(p.getName(), needle) && !contains(p.getDescription(), needle)
                    && !contains(p.getObjective(), needle)) {
                continue;
            }
            if (query.getReqId() != null && !query.getReqId().equals(p.getId())) {
                continue;
            }
            if (query.getStatus() != null && !query.getStatus().equals(p.getStatus())) {
                continue;
            }
            if (query.getOwner() != null && !query.getOwner().equals(p.getOwnerUserId())
                    && !query.getOwner().equals(p.getOwnerName())) {
                continue;
            }
            if (!within(p.getPlannedEnd(), from, to)) {
                continue;
            }
            SearchHit h = new SearchHit();
            h.setType("project");
            h.setId(p.getId());
            h.setTitle(p.getName());
            h.setStatus(p.getStatus());
            h.setExtra(p.getArchivedAt() == null ? "项目" : "项目 · 已归档");
            h.setUpdatedAt(p.getUpdatedAt());
            out.add(h);
        }
        return out;
    }

    private static boolean within(LocalDate value, LocalDate from, LocalDate to) {
        if (from == null && to == null) {
            return true;
        }
        if (value == null) {
            return false;
        }
        if (from != null && value.isBefore(from)) {
            return false;
        }
        return to == null || !value.isAfter(to);
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

    /** 用例命中理由与工作项同口径：编号在前、模块在后；未取号保持原样 */
    private static String caseExtra(SearchHit h) {
        String no = Nos.testCase(h.getCaseNo());
        if (no.isEmpty()) {
            return h.getExtra();
        }
        String module = Texts.trimToNull(h.getExtra());
        return module == null ? no : no + " · " + module;
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

    /** 围绕关键词截取摘要窗口（前后各 30 字符），超出部分用省略号标记 */
    private static String snippetAround(String brief, String q) {
        if (brief == null || brief.isEmpty()) {
            return null;
        }
        if (q == null) {
            return brief.length() <= 80 ? brief : brief.substring(0, 80) + "…";
        }
        String lower = brief.toLowerCase();
        int idx = lower.indexOf(q.toLowerCase());
        if (idx < 0) {
            return brief.length() <= 80 ? brief : brief.substring(0, 80) + "…";
        }
        int start = Math.max(0, idx - 30);
        int end = Math.min(brief.length(), idx + q.length() + 30);
        StringBuilder sb = new StringBuilder();
        if (start > 0) sb.append("…");
        sb.append(brief, start, end);
        if (end < brief.length()) sb.append("…");
        return sb.toString();
    }
}
