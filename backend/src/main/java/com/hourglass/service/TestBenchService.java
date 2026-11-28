package com.hourglass.service;

import com.hourglass.entity.Requirement;
import com.hourglass.mapper.MyWorkMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TestBenchMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 测试工作台汇总：把新手流程条与任务清单需要的跨项目聚合收在一个请求里。
 * 只统计当前用户可见且未归档的项目，与普通成员的项目可见性口径一致。
 */
@Service
public class TestBenchService {

    private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final int MAX_PROJECTS = 1000;
    private static final int ACTIVE_PLAN_LIMIT = 6;
    private static final int DONE_PLAN_LIMIT = 3;

    private final TestBenchMapper benchMapper;
    private final RequirementMapper requirementMapper;
    private final MyWorkMapper myWorkMapper;

    public TestBenchService(TestBenchMapper benchMapper, RequirementMapper requirementMapper,
                            MyWorkMapper myWorkMapper) {
        this.benchMapper = benchMapper;
        this.requirementMapper = requirementMapper;
        this.myWorkMapper = myWorkMapper;
    }

    public Map<String, Object> summary(String workspaceId, String userId) {
        List<String> reqIds = visibleReqIds(workspaceId, userId);

        Map<String, Object> cases = new LinkedHashMap<String, Object>();
        Map<String, Object> plans = new LinkedHashMap<String, Object>();
        List<Map<String, Object>> activePlans = new ArrayList<Map<String, Object>>();
        List<Map<String, Object>> donePlans = new ArrayList<Map<String, Object>>();
        Map<String, Object> bugs = new LinkedHashMap<String, Object>();
        if (!reqIds.isEmpty()) {
            cases.putAll(benchMapper.caseCounts(workspaceId, reqIds));
            plans.putAll(benchMapper.planCounts(workspaceId, reqIds));
            activePlans.addAll(planRows(benchMapper.selectActivePlans(workspaceId, reqIds, ACTIVE_PLAN_LIMIT)));
            donePlans.addAll(planRows(benchMapper.selectDonePlans(workspaceId, reqIds, DONE_PLAN_LIMIT)));
            bugs.put("total", benchMapper.countBugs(workspaceId, reqIds));
        } else {
            cases.put("total", 0);
            cases.put("passed", 0);
            cases.put("failed", 0);
            cases.put("blocked", 0);
            cases.put("untested", 0);
            plans.put("total", 0);
            plans.put("running", 0);
            plans.put("done", 0);
            bugs.put("total", 0);
        }

        /* 我的待办：与「我的工作 → 待我执行」同一口径，只取前 5 条供工作台卡片 */
        int mineTotal = myWorkMapper.countMyTestPlans(workspaceId, userId);
        List<Map<String, Object>> mineItems = mineTotal <= 0
                ? new ArrayList<Map<String, Object>>()
                : planRows(myWorkMapper.selectMyTestPlans(workspaceId, userId, 0, 5));
        Map<String, Object> mine = new LinkedHashMap<String, Object>();
        mine.put("total", mineTotal);
        mine.put("items", mineItems);

        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("cases", cases);
        res.put("plans", plans);
        res.put("activePlans", activePlans);
        res.put("donePlans", donePlans);
        res.put("bugs", bugs);
        res.put("mine", mine);
        res.put("updatedAt", LocalDateTime.now().format(TIME_FORMAT));
        return res;
    }

    /** 可见项目：与项目列表同一 visibleScope；归档项目不参与工作台聚合 */
    private List<String> visibleReqIds(String workspaceId, String userId) {
        int count = requirementMapper.countVisible(workspaceId, userId);
        if (count <= 0) {
            return new ArrayList<String>();
        }
        List<Requirement> rows = requirementMapper.selectPage(workspaceId, userId, 0,
                Math.min(count, MAX_PROJECTS));
        List<String> ids = new ArrayList<String>();
        for (Requirement r : rows) {
            if (r.getArchivedAt() == null) {
                ids.add(r.getId());
            }
        }
        return ids;
    }

    /** MyTestPlanRow 转 map 输出（保持 DTO 字段命名：caseCount/executedCount/...） */
    private static List<Map<String, Object>> planRows(List<com.hourglass.dto.MyTestPlanRow> rows) {
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (com.hourglass.dto.MyTestPlanRow row : rows) {
            Map<String, Object> m = new LinkedHashMap<String, Object>();
            m.put("id", row.getId());
            m.put("name", row.getName());
            m.put("reqId", row.getReqId());
            m.put("reqName", row.getReqName());
            m.put("versionName", row.getVersionName());
            m.put("status", row.getStatus());
            m.put("plannedStart", row.getPlannedStart());
            m.put("plannedEnd", row.getPlannedEnd());
            m.put("createdAt", row.getCreatedAt());
            m.put("caseCount", row.getCaseCount());
            m.put("executedCount", row.getExecutedCount());
            m.put("passedCount", row.getPassedCount());
            m.put("failedCount", row.getFailedCount());
            m.put("blockedCount", row.getBlockedCount());
            m.put("skippedCount", row.getSkippedCount());
            out.add(m);
        }
        return out;
    }
}
