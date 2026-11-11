package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ReqDocView;
import com.hourglass.entity.Demand;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.ReqDocShareMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementDocHistoryMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** P0 修复回归：需求池文档列表按查看人可见范围过滤。 */
class RequirementDocServiceVisibilityTest {

    private static final String WS = "W1";
    private static final String USER = "U1";

    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final RequirementMapper reqs = mock(RequirementMapper.class);
    private final UserMapper users = mock(UserMapper.class);
    private final TaskMapper tasks = mock(TaskMapper.class);
    private final WorkActivityService activities = mock(WorkActivityService.class);
    private final DemandMapper demands = mock(DemandMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final RequirementDocService service = new RequirementDocService(docs,
            mock(RequirementDocHistoryMapper.class), mock(com.hourglass.mapper.RequirementDocCommentMapper.class),
            reqs, users, tasks,
            activities, demands, access, mock(NotificationEventService.class),
            mock(ReqDocShareMapper.class), mock(WorkspaceMapper.class), mock(DocPreviewService.class),
            mock(DeletionTraceService.class));

    @Test
    void docsOfDemandPushesViewerAndDraftVisibilityIntoPageQuery() {
        Demand demand = new Demand();
        demand.setId("DM1");
        demand.setWorkspaceId(WS);
        demand.setReqId("R1");
        when(demands.selectById("DM1")).thenReturn(demand);
        when(access.viewerScope(WS, USER)).thenReturn(USER);
        when(access.roleOf(WS, USER)).thenReturn(ProjectAccessService.ROLE_MEMBER);
        when(docs.countByDemand(WS, "DM1", USER, USER, false)).thenReturn(1);
        when(docs.selectByDemand(WS, "DM1", USER, USER, false, 0, 100))
                .thenReturn(java.util.Collections.singletonList(view("D1", "R1")));

        com.hourglass.dto.PageResult<ReqDocView> visible = service.docsOfDemand(WS, "DM1", USER, 0, 100);

        assertEquals(1, visible.getTotal());
        assertEquals(1, visible.getItems().size());
        assertEquals("D1", visible.getItems().get(0).getId());
        assertEquals("正文", visible.getItems().get(0).getExcerpt());
    }

    @Test
    void docsOfDemandRejectsWhenDemandProjectItselfIsInvisible() {
        Demand demand = new Demand();
        demand.setId("DM1");
        demand.setWorkspaceId(WS);
        demand.setReqId("R1");
        when(demands.selectById("DM1")).thenReturn(demand);
        doThrow(AppException.notFound("项目不存在：R1")).when(access).assertView(WS, USER, "R1");

        assertThrows(AppException.class, () -> service.docsOfDemand(WS, "DM1", USER, 0, 100));
    }

    @Test
    void docsOfDemandMissingDemandIsNotFound() {
        when(demands.selectById("DM9")).thenReturn(null);

        assertThrows(AppException.class, () -> service.docsOfDemand(WS, "DM9", USER, 0, 100));
    }

    private ReqDocView view(String id, String reqId) {
        ReqDocView v = new ReqDocView();
        v.setId(id);
        v.setReqId(reqId);
        v.setContentBrief("<p>正文</p>");
        v.setPublishedAt(LocalDateTime.now());
        return v;
    }
}
