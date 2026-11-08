package com.hourglass.service;

import com.hourglass.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationAdapter;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.concurrent.ConcurrentHashMap;

/**
 * 账号级会话代次：持久化在 app_user.session_version，进程内缓存减少每请求查询。
 *
 * <p>登录时把 current() 写进会话；密码/平台角色变更时 bump()。
 * 重启后缓存为空，第一次校验从数据库取回同一代次，旧会话仍然有效；
 * 多实例部署时其它实例的缓存不会主动失效，因此仍按单实例部署。</p>
 */
@Service
public class SessionEpochService {

    private final UserMapper userMapper;
    private final ConcurrentHashMap<String, Long> cache = new ConcurrentHashMap<String, Long>();

    public SessionEpochService(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    public long current(String userId) {
        if (userId == null) {
            return 0L;
        }
        Long cached = cache.get(userId);
        if (cached != null) {
            return cached;
        }
        Long db = userMapper.selectSessionVersion(userId);
        long value = db == null ? 0L : db;
        cache.put(userId, value);
        return value;
    }

    public long bump(String userId) {
        if (userId == null) {
            return 0L;
        }
        userMapper.bumpSessionVersion(userId);
        Long db = userMapper.selectSessionVersion(userId);
        /* 提交后再次失效，避免并发请求在事务提交前把旧代次重新填回缓存。 */
        cache.remove(userId);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronizationAdapter() {
                @Override
                public void afterCommit() {
                    cache.remove(userId);
                }
            });
        }
        return db == null ? 0L : db;
    }

    public void forget(String userId) {
        if (userId != null) {
            cache.remove(userId);
        }
    }
}
