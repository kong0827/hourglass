package com.devstudio.kanban.service;

import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 每空间一个内存版本号，供 ETag 协商缓存使用（单实例部署）。
 * 任何成功的写请求都会 bump；读请求只需比较版本，不必查库。
 */
@Service
public class WorkspaceVersionService {

    /** 进程启动标识：重启后版本归零也不会命中旧缓存 */
    public static final String BOOT_ID = UUID.randomUUID().toString().substring(0, 8);

    private final Map<String, AtomicLong> versions = new ConcurrentHashMap<String, AtomicLong>();

    public long version(String workspaceId) {
        if (workspaceId == null) {
            return 0L;
        }
        AtomicLong v = versions.get(workspaceId);
        return v == null ? 0L : v.get();
    }

    public void bump(String workspaceId) {
        if (workspaceId == null || workspaceId.isEmpty()) {
            return;
        }
        versions.computeIfAbsent(workspaceId, k -> new AtomicLong()).incrementAndGet();
    }

    /**
     * 弱 ETag：空间 + 用户 + 启动批次 + 版本 + 查询串哈希。
     * 必须带用户维度：响应体按项目可见范围裁剪，同一浏览器切换账号后
     * 不能复用上一个用户的 304 缓存。
     */
    public String etag(String workspaceId, String userId, String queryString, long version) {
        int qh = queryString == null ? 0 : queryString.hashCode();
        return "W/\"" + workspaceId + "-" + userId + "-" + BOOT_ID + "-" + version + "-"
                + Integer.toHexString(qh) + "\"";
    }
}
