package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.WorkspaceUpdateRequest;
import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.ProjectMemberMapper;
import com.hourglass.mapper.BoardColumnMapper;
import com.hourglass.mapper.CategoryMapper;
import com.hourglass.mapper.InviteMapper;
import com.hourglass.mapper.SavedViewMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
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
    private com.hourglass.mapper.TaskWatchMapper taskWatchMapper;
    private ActivityService activityService;

    @BeforeEach
    void setUp() {
        workspaceMapper = mock(WorkspaceMapper.class);
        memberMapper = mock(WorkspaceMemberMapper.class);
        userMapper = mock(UserMapper.class);
        taskWatchMapper = mock(com.hourglass.mapper.TaskWatchMapper.class);
        memberCache = new WorkspaceMemberCache(workspaceMapper, memberMapper, 60_000L,
                new AtomicLong(1_000_000L)::get);
        activityService = mock(ActivityService.class);
        service = new WorkspaceService(workspaceMapper, memberMapper, userMapper,
                mock(BoardColumnMapper.class), mock(com.hourglass.mapper.ColumnTransitionMapper.class),
                mock(CategoryMapper.class),
                mock(com.hourglass.mapper.WorkspacePriorityMapper.class),
                mock(SavedViewMapper.class),
                mock(com.hourglass.mapper.AppNotificationMapper.class),
                mock(com.hourglass.mapper.UserListPreferenceMapper.class),
                mock(WorkActivityService.class),
                mock(InviteMapper.class), mock(com.hourglass.mapper.InviteProjectGrantMapper.class),
                mock(ProjectMemberMapper.class),
                mock(com.hourglass.mapper.ProjectMemberRoleMapper.class),
                taskWatchMapper, mock(TaskCascade.class),
                activityService, memberCache, mock(WorkspaceMetaCache.class));

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
        verify(activityService).logConfig(WS, OWNER, "更新空间设置：名称、通知渠道");
    }

    @Test
    void createSharedSpaceLeavesConfigActivity() {
        service.createShared(OWNER, "团队");

        verify(activityService).logConfig(anyString(), eq(OWNER), contains("创建共享空间「团队」"));
    }

    @Test
    void directMemberAddLeavesConfigActivity() {
        com.hourglass.entity.AppUser u = new com.hourglass.entity.AppUser();
        u.setId("U3");
        u.setUsername("wang");
        u.setDisplayName("小王");
        when(userMapper.selectByUsername("wang")).thenReturn(u);
        when(memberMapper.selectMember(WS, "U3")).thenReturn(null);

        service.addMember(OWNER, WS, "wang");

        verify(activityService).logConfig(WS, OWNER, "添加成员「小王」");
    }

    @Test
    void joinByInviteLeavesConfigActivity() {
        when(memberMapper.selectMember(WS, "U4")).thenReturn(null);

        service.joinByInvite(WS, "U4");

        verify(activityService).logConfig(WS, "U4", "通过邀请链接加入空间");
    }

    @Test
    void managerCanLabelMemberCompany() {
        service.updateMemberCompany(OWNER, WS, MEMBER, "  外部协作公司  ");

        verify(memberMapper).updateCompanyName(WS, MEMBER, "外部协作公司");
        verify(activityService).logConfig(eq(WS), eq(OWNER), contains("外部协作公司"));
    }

    @Test
    void blankCompanyClearsLabel() {
        service.updateMemberCompany(OWNER, WS, MEMBER, "   ");

        verify(memberMapper).updateCompanyName(WS, MEMBER, null);
        verify(activityService).logConfig(eq(WS), eq(OWNER), contains("清除"));
    }

    @Test
    void ordinaryMemberCannotLabelCompany() {
        assertThrows(AppException.class,
                () -> service.updateMemberCompany(MEMBER, WS, OWNER, "外部公司"));
        verify(memberMapper, times(0)).updateCompanyName(anyString(), anyString(), anyString());
    }

    @Test
    void companyNameLongerThan64IsRejected() {
        StringBuilder name = new StringBuilder();
        for (int i = 0; i < 65; i++) {
            name.append('司');
        }

        assertThrows(AppException.class,
                () -> service.updateMemberCompany(OWNER, WS, MEMBER, name.toString()));
        verify(memberMapper, times(0)).updateCompanyName(anyString(), anyString(), anyString());
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
