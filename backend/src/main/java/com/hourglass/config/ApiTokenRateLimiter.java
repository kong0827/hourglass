package com.hourglass.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 对外 API 的按令牌限流（单实例内存实现，与现有 AI 限流同口径）。
 * 读写分桶：只读令牌只会命中读桶；写桶预留给后续写接口。
 */
@Component
public class ApiTokenRateLimiter {

    private static final long WINDOW_MS = 60_000L;

    private final int readPerMinute;
    private final int writePerMinute;
    private final ConcurrentHashMap<String, Deque<Long>> hits =
            new ConcurrentHashMap<String, Deque<Long>>();

    public ApiTokenRateLimiter(@Value("${app.api.rate.read-per-minute:120}") int readPerMinute,
                               @Value("${app.api.rate.write-per-minute:30}") int writePerMinute) {
        this.readPerMinute = readPerMinute;
        this.writePerMinute = writePerMinute;
    }

    public boolean allow(String tokenId, boolean write) {
        int limit = write ? writePerMinute : readPerMinute;
        if (limit <= 0) {
            return true;
        }
        long now = System.currentTimeMillis();
        Deque<Long> window = hits.computeIfAbsent(tokenId + (write ? ":w" : ":r"),
                key -> new ArrayDeque<Long>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() >= WINDOW_MS) {
                window.pollFirst();
            }
            if (window.size() >= limit) {
                return false;
            }
            window.addLast(now);
            return true;
        }
    }
}