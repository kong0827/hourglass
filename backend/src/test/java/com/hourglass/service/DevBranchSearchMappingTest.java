package com.hourglass.service;

import com.hourglass.dto.BranchQuery;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** 分支关键词搜索按版本名/项目名命中时，只能经由查看人可见项目的工作项，避免公共分支透出隐藏项目名称 */
class DevBranchSearchMappingTest {

    private Configuration configuration() throws Exception {
        Configuration cfg = new Configuration();
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.entity");
        cfg.getTypeAliasRegistry().registerAliases("com.hourglass.dto");
        String file = "mapper/DevBranchMapper.xml";
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(file)) {
            assertNotNull(input);
            new XMLMapperBuilder(input, cfg, file, cfg.getSqlFragments()).parse();
        }
        return cfg;
    }

    private static String sql(Configuration cfg, String statement, BranchQuery q) {
        Map<String, Object> params = new HashMap<String, Object>();
        params.put("q", q);
        return cfg.getMappedStatement("com.hourglass.mapper.DevBranchMapper." + statement)
                .getBoundSql(params).getSql().replaceAll("\\s+", " ");
    }

    private static BranchQuery query(String viewerId) {
        BranchQuery q = new BranchQuery();
        q.setWorkspaceId("W");
        q.setViewerId(viewerId);
        q.setQ("支付");
        return q;
    }

    @Test
    void keywordSearchThroughTasksRespectsViewerProjectVisibility() throws Exception {
        Configuration cfg = configuration();
        for (String statement : new String[]{"selectPage", "countOptions", "selectOptions", "countGroupByStatus"}) {
            String s = sql(cfg, statement, query("U1"));
            assertTrue(s.contains("pm.project_id = t3.req_id"), statement + "：版本名命中需过滤隐藏项目");
            assertTrue(s.contains("pm.project_id = t4.req_id"), statement + "：项目名命中需过滤隐藏项目");
            assertFalse(s.contains("${alias}"), statement + "：片段别名必须被替换");
        }
    }

    @Test
    void privilegedViewerSearchHasNoExtraVisibilityFilter() throws Exception {
        String s = sql(configuration(), "selectPage", query(null));
        assertFalse(s.contains("pm.project_id = t3.req_id"));
        assertFalse(s.contains("pm.project_id = t4.req_id"));
        assertTrue(s.contains("pv3.name LIKE"), "关键词仍可按版本名搜索");
    }
}
