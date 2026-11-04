package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Texts;
import com.devstudio.kanban.entity.MailDelivery;
import com.devstudio.kanban.mapper.MailDeliveryMapper;
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

    private final MailDeliveryMapper mapper;
    private final SmtpMailService smtp;

    public MailDeliveryService(MailDeliveryMapper mapper, SmtpMailService smtp) {
        this.mapper = mapper;
        this.smtp = smtp;
    }

    /** 必须在调用方业务事务内执行；发送异常不会发生在这里，也不会回滚主业务。 */
    public void enqueue(String recipient, String subject, String body, String eventType, String referenceId) {
        String to = Texts.trimToNull(recipient);
        if (to == null || !smtp.isEnabled()) {
            return;
        }
        try {
            MailDelivery d = new MailDelivery();
            d.setRecipient(to);
            d.setSubject(cut(subject, 255));
            d.setBody(cut(body, 4000));
            d.setEventType(eventType);
            d.setReferenceId(referenceId);
            mapper.insert(d);
        } catch (Exception e) {
            log.warn("邮件 outbox 写入失败（不影响主业务）：event={} ref={}", eventType, referenceId, e);
        }
    }

    @Scheduled(fixedDelayString = "${app.mail.scan-ms:30000}", initialDelayString = "${app.mail.initial-delay-ms:10000}")
    public void dispatchDue() {
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
                smtp.send(d.getRecipient(), d.getSubject(), d.getBody());
                mapper.markSent(d.getId(), now());
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
