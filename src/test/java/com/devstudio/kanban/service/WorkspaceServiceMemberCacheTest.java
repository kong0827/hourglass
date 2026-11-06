package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.WorkspaceUpdateRequest;
import com.devstudio.kanban.entity.Workspace;
import com.devstudio.kanban.entity.WorkspaceMember;
import com.devstudio.kanban.mapper.ProjectMemberMapper;
import com.devstudio.kanban.mapper.BoardColumnMapper;
import com.devstudio.kanban.mapper.CategoryMapper;
import com.devstudio.kanban.mapper.InviteMapper;
import com.devstudio.kanban.mapper.SavedViewMapper;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 成员写入口必须让成员关系缓存立即失效（移除/退出/改名）。 */
class WorkspaceServiceMemberCacheTest {

    private static final String WS = "S1";
    private static final String OWNER = "U1";
    private static final String MEMBER = "U2";

    private WorkspaceMapper workspaceMapper;
    private WorkspaceMemberMapper memberMapper;
    private UserMapper userMapper;
    private WorkspaceService service;
    private WorkspaceMemberCache memberCache;
    private com.devstudio.kanban.mapper.TaskWatchMapper taskWatchMapper;

    @BeforeEach
    void setUp() {
        workspaceMapper = mock(WorkspaceMapper.class);
        memberMapper = mock(WorkspaceMemberMapper.class);
        userMapper = mock(UserMapper.class);
        taskWatchMapper = mock(com.devstudio.kanban.mapper.TaskWatchMapper.class);
        memberCache = new WorkspaceMemberCache(workspaceMapper, memberMapper, 60_000L,
                new AtomicLong(1_000_000L)::get);
        service = new WorkspaceService(workspaceMapper, memberMapper, userMapper,
                mock(BoardColumnMapper.class), mock(CategoryMapper.class),
                mock(com.devstudio.kanban.mapper.WorkspacePriorityMapper.class),
                mock(SavedViewMapper.class),
                mock(com.devstudio.kanban.mapper.AppNotificationMapper.class),
                mock(com.devstudio.kanban.mapper.UserListPreferenceMapper.class),
                mock(WorkActivityService.class),
                mock(InviteMapper.class), mock(ProjectMemberMapper.class),
                taskWatchMapper, mock(TaskCascade.class),
                mock(ActivityService.class), memberCache, mock(WorkspaceMetaCache.class));

        when(workspaceMapper.selectById(WS)).thenReturn(workspace());
        when(memberMapper.selectMember(WS, OWNER)).thenReturn(member(OWNER, "owner"));
        when(memberMapper.selectMember(WS, MEMBER)).thenReturn(member(MEMBER, "member"));
    }

    @Test
    void personalIdSupportsLegacyMaxLengthUserIds() {
        String legacyUserId = "0123456789abcdef0123456789abcdef";
        String personalId = WorkspaceService.personalId(legacyUserId);

        assertEquals(32, personalId.length());
        assertEquals(personalId, WorkspaceService.personalId(legacyUserId));
        assertTrue(personalId.startsWith(WorkspaceService.PERSONAL_PREFIX));
        assertEquals("WYyu01", WorkspaceService.personalId("Yyu01"));
    }

    @Test
    void removedMemberIsEvictedAndLosesAccessImmediately() {
        assertEquals("member", service.requireMember(MEMBER, WS).getMyRole());
        verify(memberMapper, times(1)).selectMember(WS, MEMBER);

        service.removeMember(OWNER, WS, MEMBER);
        /* 移除后目标成员从库里消失：缓存已失效，再读即重新查库 */
        when(memberMapper.selectMember(WS, MEMBER)).thenReturn(null);

        assertThrows(AppException.class, () -> service.requireMember(MEMBER, WS));
        verify(memberMapper).delete(WS, MEMBER);
        verify(taskWatchMapper).deleteByWorkspaceUser(WS, MEMBER);
        verify(memberMapper, times(3)).selectMember(WS, MEMBER);
    }

    @Test
    void workspaceUpdateEvictsCachedSnapshotsForAllMembers() {
        service.requireMember(MEMBER, WS);
        verify(memberMapper, times(1)).selectMember(WS, MEMBER);

        WorkspaceUpdateRequest req = new WorkspaceUpdateRequest();
        req.setName("new-name");
        /* pushplus 不校验空间地址，测试不依赖外网 DNS */
        req.setNotifyChannel("pushplus");
        service.update(OWNER, WS, req);

        service.requireMember(MEMBER, WS);
        verify(memberMapper, times(2)).selectMember(WS, MEMBER);
        verify(workspaceMapper, times(1)).update(any(Workspace.class));
    }

    private static Workspace workspace() {
        Workspace ws = new Workspace();
        ws.setId(WS);
        ws.setName("space");
        ws.setType("shared");
        ws.setOwnerId(OWNER);
        ws.setNotifyWebhook("https://hook.example/x");
        return ws;
    }

    private static WorkspaceMember member(String userId, String role) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(WS);
        m.setUserId(userId);
        m.setRole(role);
        return m;
    }
}
