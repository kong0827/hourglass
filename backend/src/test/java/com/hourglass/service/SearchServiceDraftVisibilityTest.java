package com.hourglass.service;

import com.hourglass.dto.DemandPage;
import com.hourglass.dto.TaskListResponse;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.TestCaseMapper;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 回归：文档草稿（未发布）不能出现在非作者、非特权成员的全局搜索结果里。 */
class SearchServiceDraftVisibilityTest {

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
    void memberSearchOnlyMatchesOwnDrafts() {
        stubEmptySources();
        when(access.viewerScope(WS, USER)).thenReturn(USER);
        when(access.roleOf(WS, USER)).thenReturn("member");

        service.search(WS, USER, "结算", 5);

        verify(docs).searchVisible(WS, USER, USER, false, "结算", 5);
    }

    @Test
    void privilegedRoleSearchSeesAllDrafts() {
        stubEmptySources();
        when(access.viewerScope(WS, USER)).thenReturn(null);
        when(access.roleOf(WS, USER)).thenReturn("owner");

        service.search(WS, USER, "结算", 5);

        verify(docs).searchVisible(WS, null, USER, true, "结算", 5);
    }

    private void stubEmptySources() {
        when(reqs.list(WS, USER)).thenReturn(Collections.emptyList());
        when(tasks.list(eq(WS), eq(USER), any(), eq("updated"), eq(0), anyInt())).thenReturn(new TaskListResponse());
        when(demands.page(eq(WS), eq(USER), any())).thenReturn(new DemandPage());
        when(docs.searchVisible(anyString(), any(), anyString(), anyBoolean(), anyString(), anyInt()))
                .thenReturn(Collections.emptyList());
        when(cases.searchVisible(anyString(), any(), anyString(), anyInt())).thenReturn(Collections.emptyList());
    }
}
