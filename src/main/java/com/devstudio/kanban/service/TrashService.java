package com.devstudio.kanban.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 回收站自动清理：删除满 30 天的任务（含子任务/标签关联/附件/工时/日志）
 */
@Service
public class TrashService {

    private static final Logger log = LoggerFactory.getLogger(TrashService.class);
    private static final int KEEP_DAYS = 30;

    private final TaskService taskService;

    public TrashService(TaskService taskService) {
        this.taskService = taskService;
    }

    @Scheduled(cron = "0 30 4 * * *")
    public void purgeExpired() {
        try {
            int count = taskService.purgeExpired(LocalDateTime.now().minusDays(KEEP_DAYS));
            if (count > 0) {
                log.info("回收站自动清理 {} 项任务（删除已超过 {} 天）", count, KEEP_DAYS);
            }
        } catch (Exception e) {
            log.warn("回收站自动清理失败", e);
        }
    }
}
