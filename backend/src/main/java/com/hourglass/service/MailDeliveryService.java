package com.hourglass.service;

import com.hourglass.common.Texts;
import com.hourglass.entity.MailDelivery;
import com.hourglass.mapper.MailDeliveryMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/** 数据库 outbox：业务事务写入，调度线程异步发送，失败最多尝试三次。 */
@Service
public class MailDeliveryService {

    private static final Logger log = LoggerFactory.getLogger(MailDeliveryService.class);
    private static final int MAX_ATTEMPTS = 3;
    private static final int BATCH_SIZE = 50;
    private static final int MAX_ERROR = 1000;
    /** 抢占租约：进程在「抢占后、落库前」退出时，租约到期才允许其他实例接手 */
    private static final int CLAIM_MINUTES = 10;
    static final String EXPIRED_SENDING_ERROR = "最后一次发送结果未回写（可能已发出）";

    private final MailDeliveryMapper mapper;
    private final SmtpMailService smtp;

    public MailDeliveryService(MailDeliveryMapper mapper, SmtpMailService smtp) {
        this.mapper = mapper;
        this.smtp = smtp;
    }

    /** 当前部署是否真正启用了 SMTP；调用方据此决定是否把「邮件」计入可达人数。 */
    public boolean isEnabled() {
        return smtp.isEnabled();
    }

    /**
     * 必须在调用方业务事务内执行；发送异常不会发生在这里，也不会回滚主业务。
     * 返回是否真的写入了 outbox：SMTP 未启用、收件人为空或写库失败都返回 false，
     * 避免调用方把「尝试投递」计成「已送达」。
     */
    public boolean enqueue(String recipient, String subject, String body, String eventType, String referenceId) {
        String to = Texts.trimToNull(recipient);
        if (to == null || !smtp.isEnabled()) {
            return false;
        }
        try {
            MailDelivery d = new MailDelivery();
            d.setRecipient(to);
            d.setSubject(cut(subject, 255));
            d.setBody(cut(body, 4000));
            d.setEventType(eventType);
            d.setReferenceId(referenceId);
            mapper.insert(d);
            return true;
        } catch (Exception e) {
            log.warn("邮件 outbox 写入失败（不影响主业务）：event={} ref={}", eventType, referenceId, e);
            return false;
        }
    }

    @Scheduled(fixedDelayString = "${app.mail.scan-ms:30000}", initialDelayString = "${app.mail.initial-delay-ms:10000}")
    public void dispatchDue() {
        closeExpiredSending();
        if (!smtp.isEnabled()) {
            return;
        }
        List<MailDelivery> due;
        try {
            due = mapper.selectDue(now(), BATCH_SIZE);
        } catch (Exception e) {
            log.warn("邮件 outbox 扫描失败，本轮跳过", e);
            return;
        }
        for (MailDelivery d : due) {
            try {
                /* 抢占失败说明另一实例已接手或这一行已被处理，本轮必须跳过 */
                if (mapper.claim(d.getId(), now(), now().plusMinutes(CLAIM_MINUTES)) != 1) {
                    continue;
                }
            } catch (Exception e) {
                log.warn("邮件发送抢占失败，本轮跳过：id={}", d.getId(), e);
                continue;
            }
            try {
                smtp.send(d.getRecipient(), d.getSubject(), d.getBody());
                /* 落库失败时保持 sending 直到租约到期；租约内不会重发，宁可晚发也不重复发 */
                if (mapper.markSent(d.getId(), now()) != 1) {
                    log.warn("邮件已发送但状态更新未命中：id={}，等待租约到期后核对", d.getId());
                }
            } catch (Exception e) {
                int attempts = (d.getAttempts() == null ? 0 : d.getAttempts()) + 1;
                boolean exhausted = attempts >= MAX_ATTEMPTS;
                LocalDateTime next = exhausted ? null : now().plusMinutes(1L << (attempts - 1));
                String error = cut(SmtpMailService.errorMessage(e), MAX_ERROR);
                try {
                    mapper.markAttemptFailed(d.getId(), exhausted ? "failed" : "pending", attempts, next, error);
                } catch (Exception updateError) {
                    log.warn("邮件失败状态落库异常：id={}", d.getId(), updateError);
                }
                log.warn("邮件发送失败：id={} 第 {}/{} 次：{}", d.getId(), attempts, MAX_ATTEMPTS, error);
            }
        }
    }

    /**
     * 租约到期仍停在 sending 的终态行：收口为 unknown（疑似已发出），只依赖数据库，
     * SMTP 关闭时也要清掉残留。结果未回写不等于失败——原发送进程若稍后回写，
     * markSent / markAttemptFailed 还会把它纠正为 sent / failed。
     */
    private void closeExpiredSending() {
        try {
            int expired = mapper.failExpiredSending(MAX_ATTEMPTS, now(), EXPIRED_SENDING_ERROR);
            if (expired > 0) {
                log.warn("邮件 outbox 回收 {} 行超时未回写的终态发送，标记为「疑似已发出」", expired);
            }
        } catch (Exception e) {
            log.warn("邮件 outbox 终态回收失败，本轮继续", e);
        }
    }

    protected LocalDateTime now() {
        return LocalDateTime.now();
    }

    private static String cut(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}
