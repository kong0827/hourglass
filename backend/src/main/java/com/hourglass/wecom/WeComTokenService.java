package com.hourglass.wecom;

import com.hourglass.entity.WeComCorp;
import org.springframework.stereotype.Service;

import java.util.concurrent.ConcurrentHashMap;

/**
 * access_token 按企业缓存（单实例，进程内）。
 *
 * <p>企微的 token 是「每企业 + 每应用」一份：不同供应商企业必须各取各的，
 * 不能共用一个 token；这里以 corpId 为键，企业改 Secret 或报 token 失效时单独清掉。
 */
@Service
public class WeComTokenService {

    private static final long EARLY_EXPIRE_SECONDS = 120;

    private final WeComApiClient api;
    private final WeComCorpService corpService;
    private final ConcurrentHashMap<String, CachedToken> cache = new ConcurrentHashMap<String, CachedToken>();
    private final ConcurrentHashMap<String, Object> locks = new ConcurrentHashMap<String, Object>();

    public WeComTokenService(WeComApiClient api, WeComCorpService corpService) {
        this.api = api;
        this.corpService = corpService;
    }

    public String token(WeComCorp corp) {
        String corpId = corp.getCorpId();
        CachedToken cached = cache.get(corpId);
        if (cached != null && cached.valid()) {
            return cached.token;
        }
        Object lock = locks.computeIfAbsent(corpId, k -> new Object());
        synchronized (lock) {
            cached = cache.get(corpId);
            if (cached != null && cached.valid()) {
                return cached.token;
            }
            String secret = corpService.secretOf(corp);
            WeComApiClient.TokenResult result = api.getToken(corpId, secret);
            cache.put(corpId, new CachedToken(result.getToken(), result.getExpiresIn()));
            return result.getToken();
        }
    }

    /** 企微报 token 失效时调用；只清这一家，不影响其它企业 */
    public void invalidate(String corpId) {
        if (corpId != null) {
            cache.remove(corpId);
        }
    }

    private static class CachedToken {
        private final String token;
        private final long expiresAtMillis;

        private CachedToken(String token, int expiresIn) {
            this.token = token;
            long ttl = Math.max(60, expiresIn - EARLY_EXPIRE_SECONDS);
            this.expiresAtMillis = System.currentTimeMillis() + ttl * 1000L;
        }

        private boolean valid() {
            return System.currentTimeMillis() < expiresAtMillis;
        }
    }
}