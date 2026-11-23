package com.hourglass.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;

/**
 * 发布准备里程碑：每天 09:05 扫描 ready 计划。
 * T-7 / T-3 / T-1 提醒未确认且未回执的负责人；T-0 提醒计划负责人与关注者。
 */
@Component
public class ReleasePrepScheduler {

    private static final Logger log = LoggerFactory.getLogger(ReleasePrepScheduler.class);

    private final ReleasePrepService prepService;

    public ReleasePrepScheduler(ReleasePrepService prepService) {
        this.prepService = prepService;
    }

    @Scheduled(cron = "${app.release.prep.cron:0 5 9 * * *}")
    public void daily() {
        try {
            prepService.scanMilestones(LocalDate.now());
        } catch (Exception e) {
            /* 单日失败不推进任何标记，下一次扫描仍会补发未发送的里程碑 */
            log.warn("发布准备里程碑扫描失败", e);
        }
    }
}
