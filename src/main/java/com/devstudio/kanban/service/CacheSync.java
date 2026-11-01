package com.devstudio.kanban.service;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 进程内缓存的失效时机：事务内写库后，缓存必须等提交完成再失效。
 * 否则提交前的并发读会把旧数据重新装回缓存，提交后没人再清，权限/配置会一直陈旧到 TTL。
 * 没有事务（单元测试、无事务的初始化路径）时立即执行。
 */
final class CacheSync {

    private CacheSync() {
    }

    static void evictAfterCommitOrNow(Runnable action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            action.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    }
}
