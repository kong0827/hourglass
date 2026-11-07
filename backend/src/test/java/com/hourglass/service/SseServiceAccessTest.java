package com.hourglass.service;

import com.hourglass.entity.ProjectMember;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.Task;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SseServiceAccessTest {

    private static final String WS = "W1";

    private final TaskMapper tasks = mock(TaskMapper.class);
    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final SseService sse = new SseService(mock(WorkspaceMemberMapper.class), tasks, docs, access);

    @Test
    void blocksMemberExplicitlyHiddenFromTaskProject() {
        Task t = new Task();
        t.setId("T1");
        t.setWorkspaceId(WS);
        t.setReqId("P1");
        when(tasks.selectById("T1")).thenReturn(t);
        when(access.grants(WS)).thenReturn(Arrays.asList(
                grant("P1", "U2", ProjectAccessService.ACCESS_NONE),
                grant("P2", "U3", ProjectAccessService.ACCESS_NONE)));

        assertEquals(Collections.singleton("U2"),
                sse.projectBlocked(WS, "T1", null, roles("U2", "member", "U3", "member")));
    }

    @Test
    void readGrantStillReceivesEvent() {
        taskIn("T1", "P1");
        when(access.grants(WS)).thenReturn(Collections.singletonList(
                grant("P1", "U2", ProjectAccessService.ACCESS_READ)));

        assertTrue(sse.projectBlocked(WS, "T1", null, roles("U2", "member")).isEmpty());
    }

    @Test
    void privilegedAndViewerAreNotBlockedByStaleGrant() {
        taskIn("T1", "P1");
        when(access.grants(WS)).thenReturn(Collections.singletonList(
                grant("P1", "U2", ProjectAccessService.ACCESS_NONE)));

        assertTrue(sse.projectBlocked(WS, "T1", null, roles("U2", "admin")).isEmpty());
        assertTrue(sse.projectBlocked(WS, "T1", null, roles("U2", "viewer")).isEmpty());
    }

    @Test
    void docEventResolvesItsProject() {
        RequirementDoc d = new RequirementDoc();
        d.setId("D1");
        d.setWorkspaceId(WS);
        d.setReqId("P1");
        when(docs.selectById("D1")).thenReturn(d);
        when(access.grants(WS)).thenReturn(Collections.singletonList(
                grant("P1", "U2", ProjectAccessService.ACCESS_NONE)));

        assertEquals(Collections.singleton("U2"), sse.projectBlocked(WS, null, "D1", roles("U2", "member")));
    }

    @Test
    void workspaceLevelEventSkipsProjectLookups() {
        assertTrue(sse.projectBlocked(WS, null, null, new HashMap<String, String>()).isEmpty());
        verifyNoInteractions(tasks, docs, access);
    }

    @Test
    void taskFromAnotherWorkspaceIsNotMatched() {
        Task t = new Task();
        t.setId("T1");
        t.setWorkspaceId("W2");
        t.setReqId("P1");
        when(tasks.selectById("T1")).thenReturn(t);

        assertTrue(sse.projectBlocked(WS, "T1", null, roles("U2", "member")).isEmpty());
        verifyNoInteractions(access);
    }

    private void taskIn(String taskId, String projectId) {
        Task t = new Task();
        t.setId(taskId);
        t.setWorkspaceId(WS);
        t.setReqId(projectId);
        when(tasks.selectById(taskId)).thenReturn(t);
    }

    private Map<String, String> roles(String... userAndRole) {
        Map<String, String> map = new HashMap<String, String>();
        for (int i = 0; i + 1 < userAndRole.length; i += 2) {
            map.put(userAndRole[i], userAndRole[i + 1]);
        }
        return map;
    }

    private ProjectMember grant(String projectId, String userId, String access) {
        ProjectMember pm = new ProjectMember();
        pm.setWorkspaceId(WS);
        pm.setProjectId(projectId);
        pm.setUserId(userId);
        pm.setAccess(access);
        return pm;
    }
}
