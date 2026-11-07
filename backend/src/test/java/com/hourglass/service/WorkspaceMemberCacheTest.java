package com.hourglass.service;

import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 成员关系缓存：命中/过期/跨空间隔离/按角色脱敏，全部离线（假时钟 + Mockito）。 */
class WorkspaceMemberCacheTest {

    private static final long TTL = 60_000L;

    private WorkspaceMapper workspaceMapper;
    private WorkspaceMemberMapper memberMapper;
    private AtomicLong now;
    private WorkspaceMemberCache cache;

    @BeforeEach
    void setUp() {
        workspaceMapper = mock(WorkspaceMapper.class);
        memberMapper = mock(WorkspaceMemberMapper.class);
        now = new AtomicLong(1_000_000L);
        cache = new WorkspaceMemberCache(workspaceMapper, memberMapper, TTL, now::get);
    }

    @Test
    void memberViewHitsCacheAndExpiresAfterTtl() {
        when(workspaceMapper.selectById("W1")).thenReturn(workspace("W1", "owner"));
        when(memberMapper.selectMember("W1", "U1")).thenReturn(member("W1", "U1", "owner"));

        Workspace first = cache.view("W1", "U1");
        Workspace second = cache.view("W1", "U1");

        assertEquals("owner", first.getMyRole());
        assertEquals("https://hook.example/x", first.getNotifyWebhook());
        assertNotSame(first, second);
        verify(memberMapper, times(1)).selectMember("W1", "U1");
        verify(workspaceMapper, times(1)).selectById("W1");

        now.addAndGet(TTL);
        cache.view("W1", "U1");
        verify(memberMapper, times(2)).selectMember("W1", "U1");
    }

    @Test
    void cacheNeverBypassesRoleMaskAndNeverSharesAcrossSpaces() {
        when(workspaceMapper.selectById("W1")).thenReturn(workspace("W1", "owner"));
        when(workspaceMapper.selectById("W2")).thenReturn(workspace("W2", "owner"));
        when(memberMapper.selectMember("W1", "U1")).thenReturn(member("W1", "U1", "owner"));
        when(memberMapper.selectMember("W2", "U1")).thenReturn(member("W2", "U1", "member"));

        Workspace owner = cache.view("W1", "U1");
        assertEquals("https://hook.example/x", owner.getNotifyWebhook());
        assertEquals("token-1", owner.getNotifyToken());

        Workspace member = cache.view("W2", "U1");
        assertEquals("member", member.getMyRole());
        assertNull(member.getNotifyWebhook());
        assertNull(member.getNotifyToken());

        /* 命中缓存（第二次不查库）仍然脱敏；调用方改返回值也污染不了缓存 */
        verify(memberMapper, times(1)).selectMember("W2", "U1");
        member.setNotifyWebhook("https://leak.example");
        assertNull(cache.view("W2", "U1").getNotifyWebhook());
        verify(memberMapper, times(1)).selectMember("W2", "U1");

        /* 角色提升后必须主动失效才可见；失效前成员视角始终拿不到 token */
        when(memberMapper.selectMember("W2", "U1")).thenReturn(member("W2", "U1", "owner"));
        assertNull(cache.view("W2", "U1").getNotifyWebhook());
        cache.evictWorkspace("W2");
        assertEquals("https://hook.example/x", cache.view("W2", "U1").getNotifyWebhook());
    }

    @Test
    void evictUserOnlyDropsThatUsersEntries() {
        when(workspaceMapper.selectById("W1")).thenReturn(workspace("W1", "owner"));
        when(memberMapper.selectMember("W1", "U1")).thenReturn(member("W1", "U1", "owner"));
        when(memberMapper.selectMember("W1", "U2")).thenReturn(member("W1", "U2", "member"));
        cache.view("W1", "U1");
        cache.view("W1", "U2");

        cache.evictUser("U1");
        cache.view("W1", "U1");
        cache.view("W1", "U2");
        verify(memberMapper, times(2)).selectMember("W1", "U1");
        verify(memberMapper, times(1)).selectMember("W1", "U2");
    }

    private static Workspace workspace(String id, String ownerId) {
        Workspace ws = new Workspace();
        ws.setId(id);
        ws.setName("space-" + id);
        ws.setType("shared");
        ws.setOwnerId(ownerId);
        ws.setNotifyWebhook("https://hook.example/x");
        ws.setNotifyToken("token-1");
        return ws;
    }

    private static WorkspaceMember member(String wsId, String userId, String role) {
        WorkspaceMember m = new WorkspaceMember();
        m.setWorkspaceId(wsId);
        m.setUserId(userId);
        m.setRole(role);
        return m;
    }
}
