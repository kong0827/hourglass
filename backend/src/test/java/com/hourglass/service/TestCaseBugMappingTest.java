package com.hourglass.service;

import com.hourglass.dto.CaseQuery;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** 用例上的缺陷关联保留为历史；筛选与覆盖统计只认未删除、未完成的缺陷工作项 */
class TestCaseBugMappingTest {

    private Configuration configuration() throws Exception {
        Configuration cfg = new Configuration();
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.dto");
        String file = "mapper/TestCaseMapper.xml";
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(file)) {
            assertNotNull(input);
            new XMLMapperBuilder(input, cfg, file, cfg.getSqlFragments()).parse();
        }
        return cfg;
    }

    private static String compact(String sql) {
        return sql.replaceAll("\\s+", " ");
    }

    private static void assertOpenBugOnly(String sql, String label) {
        assertTrue(sql.contains("bt.id = c.latest_bug_task_id"), label + "：按缺陷工作项关联");
        assertTrue(sql.contains("bt.deleted_at IS NULL"), label + "：回收站中的缺陷不计");
        assertTrue(sql.contains("bt.board_column <> 'done'"), label + "：已完成的缺陷不计");
    }

    @Test
    void bugOnlyFilterRequiresLiveUnfinishedBugTask() throws Exception {
        Configuration cfg = configuration();
        CaseQuery q = new CaseQuery();
        q.setWorkspaceId("W");
        q.setReqId("R");
        q.setBugOnly(true);
        Map<String, Object> params = new HashMap<String, Object>();
        params.put("q", q);
        for (String statement : new String[]{"countByQuery", "selectViewByQuery"}) {
            String sql = compact(cfg.getMappedStatement("com.hourglass.mapper.TestCaseMapper." + statement)
                    .getBoundSql(params).getSql());
            assertFalse(sql.contains("c.latest_bug_task_id IS NOT NULL"), statement + "：不能只看字段非空");
            assertTrue(sql.contains("EXISTS (SELECT 1 FROM task bt"), statement);
            assertOpenBugOnly(sql, statement);
        }

        q.setBugOnly(false);
        String plain = compact(cfg.getMappedStatement("com.hourglass.mapper.TestCaseMapper.countByQuery")
                .getBoundSql(params).getSql());
        assertFalse(plain.contains("FROM task bt"), "未开启筛选时不附加缺陷条件");
    }

    @Test
    void planDefectCountUsesCurrentPlanCasesAndLiveBugsOnly() throws Exception {
        Configuration cfg = new Configuration();
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.dto");
        String file = "mapper/TestPlanMapper.xml";
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(file)) {
            assertNotNull(input);
            new XMLMapperBuilder(input, cfg, file, cfg.getSqlFragments()).parse();
        }
        Map<String, Object> params = new HashMap<String, Object>();
        params.put("workspaceId", "W");
        params.put("reqId", "R");
        params.put("id", "P");
        for (String statement : new String[]{"selectViewByReq", "selectViewById"}) {
            String sql = compact(cfg.getMappedStatement("com.hourglass.mapper.TestPlanMapper." + statement)
                    .getBoundSql(params).getSql());
            assertTrue(sql.contains("COUNT(DISTINCT r.bug_task_id)"), statement + "：同一缺陷只计一次");
            assertTrue(sql.contains("JOIN test_plan_case pc ON pc.plan_id = r.plan_id AND pc.case_id = r.case_id"),
                    statement + "：已移出计划的用例不再计入");
            assertTrue(sql.contains("bt.deleted_at IS NULL"), statement + "：回收站中的缺陷不计");
        }
    }

    @Test
    void coverageBugCountUsesOnlyLiveUnfinishedBugs() throws Exception {
        Configuration cfg = configuration();
        Map<String, Object> params = new HashMap<String, Object>();
        params.put("workspaceId", "W");
        params.put("reqId", "R");
        for (String statement : new String[]{"selectCoverageByDemand", "selectUnlinkedCoverage"}) {
            String sql = compact(cfg.getMappedStatement("com.hourglass.mapper.TestCaseMapper." + statement)
                    .getBoundSql(params).getSql());
            assertTrue(sql.contains("COUNT(DISTINCT bt.id) AS bug_count"), statement);
            assertFalse(sql.contains("COUNT(DISTINCT c.latest_bug_task_id)"), statement + "：不能按历史字段计数");
            assertTrue(sql.contains("LEFT JOIN task bt"), statement + "：左连接，不影响用例总数");
            assertOpenBugOnly(sql, statement);
        }
    }
}
