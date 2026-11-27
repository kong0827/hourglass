package com.hourglass.service;

import com.hourglass.dto.DemandPage;
import com.hourglass.dto.SearchHit;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.TestCaseMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 章节级搜索：命中文档的标题再匹配一轮，产出「文档 > 章节」直达结果。 */
class SearchServiceSectionTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final TaskQueryService tasks = mock(TaskQueryService.class);
    private final RequirementService reqs = mock(RequirementService.class);
    private final DemandService demands = mock(DemandService.class);
    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final TestCaseMapper cases = mock(TestCaseMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final SearchService service = new SearchService(tasks, reqs, demands, docs, cases, access);

    @Test
    void headingHitCarriesSectionTextAndOrdinal() {
        stubEmptySources();
        when(access.viewerScope(WS, USER)).thenReturn(USER);
        when(access.roleOf(WS, USER)).thenReturn("member");

        SearchHit docHit = new SearchHit();
        docHit.setType("doc");
        docHit.setId("D1");
        docHit.setTitle("结算方案");
        when(docs.searchFiltered(anyString(), any(), anyString(), anyBoolean(), eq("结算"),
                any(), any(), any(), any(), any(), anyInt()))
                .thenReturn(Collections.singletonList(docHit));

        RequirementDoc doc = new RequirementDoc();
        doc.setId("D1");
        doc.setFormat("markdown");
        doc.setContent("# 背景\n\n## 结算流程\n\n## 对账规则\n");
        when(docs.selectById("D1")).thenReturn(doc);

        List<SearchHit> hits = service.search(WS, USER, "结算", 5);

        List<SearchHit> sections = new ArrayList<SearchHit>();
        for (SearchHit h : hits) {
            if ("doc".equals(h.getType()) && h.getSection() != null) {
                sections.add(h);
            }
        }
        assertEquals(1, sections.size());
        assertEquals("结算流程", sections.get(0).getSection());
        assertEquals(Integer.valueOf(1), sections.get(0).getHead());
        assertEquals("结算方案", sections.get(0).getTitle());
    }

    @Test
    void noKeywordMeansNoSectionHits() {
        stubEmptySources();
        when(access.viewerScope(WS, USER)).thenReturn(USER);
        when(access.roleOf(WS, USER)).thenReturn("member");

        List<SearchHit> hits = service.search(WS, USER, null, 5);

        for (SearchHit h : hits) {
            assertNull(h.getSection());
        }
    }

    private void stubEmptySources() {
        when(reqs.list(WS, USER)).thenReturn(Collections.emptyList());
        when(tasks.list(eq(WS), eq(USER), any(), eq("updated"), eq(0), anyInt()))
                .thenReturn(new TaskListResponse());
        when(demands.page(eq(WS), eq(USER), any())).thenReturn(new DemandPage());
        when(docs.searchFiltered(anyString(), any(), anyString(), anyBoolean(), any(),
                any(), any(), any(), any(), any(), anyInt())).thenReturn(Collections.emptyList());
        when(cases.searchFiltered(anyString(), any(), anyString(), any(), any(),
                any(), any(), any(), any(), anyInt())).thenReturn(Collections.emptyList());
    }
}
