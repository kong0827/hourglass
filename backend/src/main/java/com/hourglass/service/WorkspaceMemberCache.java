package com.hourglass.service;

import com.hourglass.entity.Workspace;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.WorkspaceMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * 成员关系缓存：(userId, workspaceId) → 空间快照 + 我的角色，TTL 默认 60 秒。
 *
 * <p>只在进程内、单实例有效：成员新增/移除/角色变更/空间改名删除会主动失效；
 * 直接改库或多实例部署时，其它实例最多延迟一个 TTL（60 秒）。</p>
 *
 * <p>缓存值只含空间配置与该用户的角色，不含任何用户私有数据。每次返回都是副本，
 * 且按角色脱敏（非空间主清空 webhook/token），因此命中缓存不会绕过 maskWebhook。</p>
 */
@Service
public class WorkspaceMemberCache {

    /** key 分隔符：避免 "W1" 与 "W10" 这类前缀误匹配 */
    private static final char SEP = '\u0000';

    private final WorkspaceMapper workspaceMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final long ttlMillis;
    private final LongSupplier clock;
    private final Map<String, Entry> entries = new ConcurrentHashMap<String, Entry>();

    @Autowired
    public WorkspaceMemberCache(WorkspaceMapper workspaceMapper, WorkspaceMemberMapper memberMapper,
                                @Value("${app.cache.member-ttl-seconds:60}") long ttlSeconds) {
        this(workspaceMapper, memberMapper, Math.max(0L, ttlSeconds) * 1000L, System::currentTimeMillis);
    }

    WorkspaceMemberCache(WorkspaceMapper workspaceMapper, WorkspaceMemberMapper memberMapper,
                         long ttlMillis, LongSupplier clock) {
        this.workspaceMapper = workspaceMapper;
        this.memberMapper = memberMapper;
        this.ttlMillis = ttlMillis;
        this.clock = clock;
    }

    /**
     * 成员视角的空间：不存在或不是成员返回 null。
     * 返回的是可随意修改的副本；非空间主拿不到 webhook/token。
     */
    public Workspace view(String workspaceId, String userId) {
        if (workspaceId == null || workspaceId.isEmpty() || userId == null || userId.isEmpty()) {
            return null;
        }
        String key = key(workspaceId, userId);
        long now = clock.getAsLong();
        Entry e = entries.get(key);
        if (e != null && now < e.expiresAt) {
            return maskedCopy(e);
        }
        if (e != null) {
            entries.remove(key, e);
        }

        Workspace ws = workspaceMapper.selectById(workspaceId);
        if (ws == null) {
            return null;
        }
        WorkspaceMember m = memberMapper.selectMember(workspaceId, userId);
        if (m == null) {
            return null;
        }
        Entry loaded = new Entry(rawCopy(ws), m.getRole(), now + ttlMillis);
        entries.put(key, loaded);
        return maskedCopy(loaded);
    }

    public void evict(String workspaceId, String userId) {
        if (workspaceId == null || userId == null) {
            return;
        }
        entries.remove(key(workspaceId, userId));
    }

    /** 空间成员/配置变化：清掉该空间下所有用户的成员视图 */
    public void evictWorkspace(String workspaceId) {
        if (workspaceId == null) {
            return;
        }
        String prefix = workspaceId + SEP;
        Iterator<String> it = entries.keySet().iterator();
        while (it.hasNext()) {
            if (it.next().startsWith(prefix)) {
                it.remove();
            }
        }
    }

    /** 账号删除：清掉该用户在全部空间的成员视图 */
    public void evictUser(String userId) {
        if (userId == null) {
            return;
        }
        String suffix = SEP + userId;
        Iterator<String> it = entries.keySet().iterator();
        while (it.hasNext()) {
            if (it.next().endsWith(suffix)) {
                it.remove();
            }
        }
    }

    private static String key(String workspaceId, String userId) {
        return workspaceId + SEP + userId;
    }

    private static Workspace rawCopy(Workspace src) {
        Workspace copy = new Workspace();
        BeanUtils.copyProperties(src, copy);
        copy.setMyRole(null);
        return copy;
    }

    private static Workspace maskedCopy(Entry e) {
        Workspace copy = new Workspace();
        BeanUtils.copyProperties(e.workspace, copy);
        copy.setMyRole(e.role);
        if (!"owner".equals(e.role)) {
            copy.setNotifyWebhook(null);
            copy.setNotifyToken(null);
        }
        return copy;
    }

    private static final class Entry {
        private final Workspace workspace;
        private final String role;
        private final long expiresAt;

        private Entry(Workspace workspace, String role, long expiresAt) {
            this.workspace = workspace;
            this.role = role;
            this.expiresAt = expiresAt;
        }
    }
}
