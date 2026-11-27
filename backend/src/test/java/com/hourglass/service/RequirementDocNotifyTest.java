package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.ReqDocNotifyRequest;
import com.hourglass.entity.RequirementDoc;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.AppNotificationMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.RequirementDocCommentMapper;
import com.hourglass.mapper.RequirementDocHistoryMapper;
import com.hourglass.mapper.RequirementDocMapper;
import com.hourglass.mapper.RequirementMapper;
import com.hourglass.mapper.ReqDocShareMapper;
import com.hourglass.mapper.TaskMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 发布/更新后按范围通知：范围收口、操作者排除、30 分钟去重与草稿/个人可见拦截。 */
class RequirementDocNotifyTest {

    private static final String WS = "W1";
    private static final String ACTOR = "U1";

    private final RequirementDocMapper docs = mock(RequirementDocMapper.class);
    private final ProjectAccessService access = mock(ProjectAccessService.class);
    private final NotificationEventService events = mock(NotificationEventService.class);
    private final WorkspaceMemberMapper members = mock(WorkspaceMemberMapper.class);
    private final AppNotificationMapper notes = mock(AppNotificationMapper.class);
    private final RequirementDocService service = new RequirementDocService(docs,
            mock(RequirementDocHistoryMapper.class), mock(RequirementDocCommentMapper.class),
            mock(RequirementMapper.class), mock(UserMapper.class),
            mock(TaskMapper.class), mock(WorkActivityService.class), mock(DemandMapper.class),
            access, events, mock(ReqDocShareMapper.class), mock(WorkspaceMapper.class),
            mock(DocPreviewService.class), mock(DeletionTraceService.class));

    {
        ReflectionTestUtils.setField(service, "attachmentService", mock(AttachmentService.class));
        ReflectionTestUtils.setField(service, "memberMapper", members);
        ReflectionTestUtils.setField(service, "notificationMapper", notes);
    }

    @Test
    void projectScopeSkipsActorAndCountsDelivered() {
        when(docs.selectById("D1")).thenReturn(doc(null));
        List<WorkspaceMember> roster = Arrays.asList(member("U1"), member("U2"), member("U3"));
        when(members.selectByWorkspace(WS)).thenReturn(roster);
        when(access.filterVisibleMembers(WS, roster, "R1")).thenReturn(Arrays.asList(member("U2"), member("U3")));
        when(events.notifyLinkedAs(anyString(), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), any(), any())).thenReturn(true);

        Map<String, Object> res = service.notifyMembers(ACTOR, WS, "D1", request("project", null));

        assertEquals(2, res.get("sent"));
        assertEquals(0, res.get("skipped"));
        assertEquals(2, res.get("total"), "操作者自己不在收件人里");
        verify(events).notifyLinkedAs(eq("U2"), eq(WS), anyString(), eq("doc_changed"),
                eq("文档「接口文档」已发布"), anyString(), eq("doc"), eq("D1"), eq("R1"), any());
        verify(events, never()).notifyLinkedAs(eq("U1"), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), any(), any());
    }

    @Test
    void recentNotifyIsSkippedPerRecipient() {
        when(docs.selectById("D1")).thenReturn(doc(null));
        List<WorkspaceMember> roster = Arrays.asList(member("U2"), member("U3"));
        when(members.selectByWorkspace(WS)).thenReturn(roster);
        when(access.filterVisibleMembers(WS, roster, "R1")).thenReturn(roster);
        when(notes.countRecentDocNotify(eq("U2"), eq("doc"), eq("D1"), eq("doc_changed"), any()))
                .thenReturn(1);
        when(events.notifyLinkedAs(anyString(), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), any(), any())).thenReturn(true);

        Map<String, Object> res = service.notifyMembers(ACTOR, WS, "D1", request("project", null));

        assertEquals(1, res.get("sent"));
        assertEquals(1, res.get("skipped"));
        verify(events, never()).notifyLinkedAs(eq("U2"), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), any(), any());
        verify(events).notifyLinkedAs(eq("U3"), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), any(), any());
    }

    @Test
    void deliverFailureCountedWithoutAborting() {
        when(docs.selectById("D1")).thenReturn(doc(null));
        List<WorkspaceMember> roster = Arrays.asList(member("U2"), member("U3"));
        when(members.selectByWorkspace(WS)).thenReturn(roster);
        when(access.filterVisibleMembers(WS, roster, "R1")).thenReturn(roster);
        when(events.notifyLinkedAs(eq("U2"), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), any(), any())).thenReturn(false);
        when(events.notifyLinkedAs(eq("U3"), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), any(), any())).thenReturn(true);

        Map<String, Object> res = service.notifyMembers(ACTOR, WS, "D1", request("project", null));

        assertEquals(1, res.get("sent"));
        assertEquals(1, res.get("failed"));
    }

    @Test
    void usersScopeIntersectsWithVisibilityList() {
        RequirementDoc d = doc("members");
        when(docs.selectById("D1")).thenReturn(d);
        when(docs.countVisibilityMember("D1", ACTOR)).thenReturn(1);
        when(docs.selectVisibilityMemberIds("D1")).thenReturn(Arrays.asList("U2", "U3"));
        when(events.notifyLinkedAs(anyString(), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), any(), any())).thenReturn(true);

        Map<String, Object> res = service.notifyMembers(ACTOR, WS, "D1",
                request("users", Arrays.asList("U2", "U4")));

        assertEquals(1, res.get("total"), "名单外的人点开也看不到，必须被收掉");
        verify(events).notifyLinkedAs(eq("U2"), anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), any(), any());
        verify(events, never()).notifyLinkedAs(eq("U4"), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString(), any(), any());
    }

    @Test
    void membersScopeRequiresMembersVisibility() {
        when(docs.selectById("D1")).thenReturn(doc(null));

        AppException ex = assertThrows(AppException.class,
                () -> service.notifyMembers(ACTOR, WS, "D1", request("members", null)));

        assertEquals(400, ex.getCode());
    }

    @Test
    void draftCannotNotify() {
        RequirementDoc d = doc(null);
        d.setPublishedAt(null);
        when(docs.selectById("D1")).thenReturn(d);
        when(access.canManage(WS, ACTOR)).thenReturn(true);

        AppException ex = assertThrows(AppException.class,
                () -> service.notifyMembers(ACTOR, WS, "D1", request("project", null)));

        assertEquals(400, ex.getCode());
    }

    @Test
    void personalDocCannotNotify() {
        when(docs.selectById("D1")).thenReturn(doc("personal"));

        AppException ex = assertThrows(AppException.class,
                () -> service.notifyMembers(ACTOR, WS, "D1", request("project", null)));

        assertEquals(400, ex.getCode());
    }

    @Test
    void emptyUserListRejected() {
        when(docs.selectById("D1")).thenReturn(doc(null));

        AppException ex = assertThrows(AppException.class,
                () -> service.notifyMembers(ACTOR, WS, "D1", request("users", null)));

        assertEquals(400, ex.getCode());
    }

    private RequirementDoc doc(String visibility) {
        RequirementDoc d = new RequirementDoc();
        d.setId("D1");
        d.setWorkspaceId(WS);
        d.setReqId("R1");
        d.setTitle("接口文档");
        d.setDocType("requirement");
        d.setFormat("html");
        d.setContent("<p>x</p>");
        d.setStatus("draft");
        d.setOwner("Alice");
        d.setOwnerUserId(ACTOR);
        d.setVisibility(visibility);
        d.setPublishedAt(LocalDateTime.now());
        return d;
    }

    private WorkspaceMember member(String userId) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(WS);
        m.setUserId(userId);
        m.setRole("member");
        return m;
    }

    private ReqDocNotifyRequest request(String scope, List<String> userIds) {
        ReqDocNotifyRequest req = new ReqDocNotifyRequest();
        req.setScope(scope);
        req.setUserIds(userIds);
        req.setEvent("publish");
        return req;
    }
}
