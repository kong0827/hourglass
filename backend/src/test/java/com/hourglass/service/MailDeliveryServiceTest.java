package com.hourglass.service;

import com.hourglass.entity.MailDelivery;
import com.hourglass.mapper.MailDeliveryMapper;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MailDeliveryServiceTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 11, 3, 12, 0);

    private final MailDeliveryMapper mapper = mock(MailDeliveryMapper.class);
    private final SmtpMailService smtp = mock(SmtpMailService.class);
    private final MailDeliveryService service = new MailDeliveryService(mapper, smtp) {
        @Override
        protected LocalDateTime now() {
            return NOW;
        }
    };

    @Test
    void failedAttemptUsesExponentialDelayAndRecordsError() {
        MailDelivery delivery = delivery(1L, 1);
        when(smtp.isEnabled()).thenReturn(true);
        when(mapper.selectDue(NOW, 50)).thenReturn(Collections.singletonList(delivery));
        when(mapper.claim(1L, NOW, NOW.plusMinutes(10))).thenReturn(1);
        doThrow(new IllegalStateException("SMTP refused")).when(smtp)
                .send("u@example.com", "subject", "body");

        service.dispatchDue();

        ArgumentCaptor<LocalDateTime> next = ArgumentCaptor.forClass(LocalDateTime.class);
        ArgumentCaptor<String> error = ArgumentCaptor.forClass(String.class);
        verify(mapper).markAttemptFailed(any(Long.class), any(String.class), anyInt(), next.capture(), error.capture());
        assertEquals(NOW.plusMinutes(2), next.getValue());
        assertTrue(error.getValue().contains("SMTP refused"));
        verify(mapper).markAttemptFailed(1L, "pending", 2, NOW.plusMinutes(2), error.getValue());
    }

    @Test
    void thirdFailureBecomesTerminal() {
        MailDelivery delivery = delivery(2L, 2);
        when(smtp.isEnabled()).thenReturn(true);
        when(mapper.selectDue(NOW, 50)).thenReturn(Collections.singletonList(delivery));
        when(mapper.claim(2L, NOW, NOW.plusMinutes(10))).thenReturn(1);
        doThrow(new IllegalStateException("still down")).when(smtp)
                .send("u@example.com", "subject", "body");

        service.dispatchDue();

        verify(mapper).markAttemptFailed(2L, "failed", 3, null, "still down");
    }

    @Test
    void claimFailureSkipsSendSoAnotherInstanceCanOwnTheRow() {
        MailDelivery delivery = delivery(3L, 0);
        when(smtp.isEnabled()).thenReturn(true);
        when(mapper.selectDue(NOW, 50)).thenReturn(Collections.singletonList(delivery));
        when(mapper.claim(3L, NOW, NOW.plusMinutes(10))).thenReturn(0);

        service.dispatchDue();

        verify(smtp, never()).send(any(String.class), any(String.class), any(String.class));
        verify(mapper, never()).markSent(any(Long.class), any(LocalDateTime.class));
        verify(mapper, never()).markAttemptFailed(any(Long.class), any(String.class), anyInt(),
                any(LocalDateTime.class), any(String.class));
    }

    @Test
    void successfulSendOnlyMarksSentAndRecordsNoFailure() {
        MailDelivery delivery = delivery(4L, 1);
        when(smtp.isEnabled()).thenReturn(true);
        when(mapper.selectDue(NOW, 50)).thenReturn(Collections.singletonList(delivery));
        when(mapper.claim(4L, NOW, NOW.plusMinutes(10))).thenReturn(1);
        when(mapper.markSent(4L, NOW)).thenReturn(1);

        service.dispatchDue();

        verify(mapper).markSent(4L, NOW);
        verify(mapper, never()).markAttemptFailed(any(Long.class), any(String.class), anyInt(),
                any(LocalDateTime.class), any(String.class));
    }

    @Test
    void expiredFinalSendingRowsAreClosedBeforeScanning() {
        when(smtp.isEnabled()).thenReturn(true);
        when(mapper.failExpiredSending(3, NOW, MailDeliveryService.EXPIRED_SENDING_ERROR)).thenReturn(2);
        when(mapper.selectDue(NOW, 50)).thenReturn(Collections.<MailDelivery>emptyList());

        service.dispatchDue();

        verify(mapper).failExpiredSending(3, NOW, MailDeliveryService.EXPIRED_SENDING_ERROR);
        verify(mapper).selectDue(NOW, 50);
    }

    @Test
    void terminalSqlDistinguishesUncertainFromFailedAndAllowsLateCorrection() throws Exception {
        Configuration configuration = new Configuration();
        configuration.getTypeAliasRegistry().registerAlias("MailDelivery", MailDelivery.class);
        try (java.io.InputStream input = getClass().getResourceAsStream("/mapper/MailDeliveryMapper.xml")) {
            new XMLMapperBuilder(input, configuration, "mapper/MailDeliveryMapper.xml", configuration.getSqlFragments()).parse();
        }
        java.util.Map<String, Object> expired = new java.util.HashMap<String, Object>();
        expired.put("maxAttempts", 3);
        expired.put("now", NOW);
        expired.put("message", MailDeliveryService.EXPIRED_SENDING_ERROR);
        java.util.Map<String, Object> sent = new java.util.HashMap<String, Object>();
        sent.put("id", 1L);
        sent.put("sentAt", NOW);
        java.util.Map<String, Object> failed = new java.util.HashMap<String, Object>();
        failed.put("id", 1L);
        failed.put("status", "failed");
        failed.put("attempts", 3);
        failed.put("nextAttemptAt", null);
        failed.put("lastError", "x");

        assertTrue(mapperSql(configuration, "failExpiredSending", expired).contains("set status = 'unknown'"),
                "租约过期必须收口为 unknown，而不是 failed");
        assertTrue(mapperSql(configuration, "markSent", sent).contains("status in ('sending', 'unknown')"),
                "晚到的成功要把 unknown 纠正为 sent");
        assertTrue(mapperSql(configuration, "markAttemptFailed", failed).contains("status in ('sending', 'unknown')"),
                "确定失败要把 unknown 纠正为 failed");
    }

    private static String mapperSql(Configuration configuration, String id, java.util.Map<String, Object> params) {
        return configuration.getMappedStatement("com.hourglass.mapper.MailDeliveryMapper." + id)
                .getBoundSql(params).getSql().replaceAll("\\s+", " ").trim().toLowerCase();
    }

    @Test
    void cleanupFailureStillScansDueRows() {
        when(smtp.isEnabled()).thenReturn(true);
        when(mapper.failExpiredSending(anyInt(), any(LocalDateTime.class), any(String.class)))
                .thenThrow(new RuntimeException("db down"));
        when(mapper.selectDue(NOW, 50)).thenReturn(Collections.<MailDelivery>emptyList());

        service.dispatchDue();

        verify(mapper).selectDue(NOW, 50);
    }

    @Test
    void disabledSmtpStillClosesExpiredSendingButDoesNotScan() {
        when(smtp.isEnabled()).thenReturn(false);

        service.dispatchDue();

        verify(mapper).failExpiredSending(3, NOW, MailDeliveryService.EXPIRED_SENDING_ERROR);
        verify(mapper, never()).selectDue(any(), anyInt());
        verify(smtp, never()).send(any(String.class), any(String.class), any(String.class));
    }

    @Test
    void enqueueReportsWhetherOutboxRowWasWritten() {
        when(smtp.isEnabled()).thenReturn(false);
        assertEquals(false, service.enqueue("u@example.com", "s", "b", "release_prep", "P1"),
                "SMTP 未启用时不能假装已投递");
        verify(mapper, never()).insert(any(MailDelivery.class));

        when(smtp.isEnabled()).thenReturn(true);
        assertEquals(false, service.enqueue("  ", "s", "b", "release_prep", "P1"), "空收件人也算未写入");
        when(mapper.insert(any(MailDelivery.class))).thenThrow(new RuntimeException("db down"));
        assertEquals(false, service.enqueue("u@example.com", "s", "b", "release_prep", "P1"),
                "写库失败同样返回 false，供调用方如实计数");
    }

    @Test
    void enqueueInsertsWhenSmtpEnabled() {
        when(smtp.isEnabled()).thenReturn(true);

        assertEquals(true, service.enqueue("u@example.com", "s", "b", "release_prep", "P1"));
        verify(mapper).insert(any(MailDelivery.class));
    }

    @Test
    void workspaceCleanupNormalizesCrossTableCollationAndKeepsBothScopes() throws Exception {
        Configuration configuration = new Configuration();
        configuration.getTypeAliasRegistry().registerAlias("MailDelivery", MailDelivery.class);
        try (java.io.InputStream input = getClass().getResourceAsStream("/mapper/MailDeliveryMapper.xml")) {
            new XMLMapperBuilder(input, configuration, "mapper/MailDeliveryMapper.xml", configuration.getSqlFragments()).parse();
        }
        BoundSql bound = configuration.getMappedStatement("com.hourglass.mapper.MailDeliveryMapper.deleteByWorkspaceReferences")
                .getBoundSql(Collections.singletonMap("workspaceId", "W1"));
        assertEquals("DELETE FROM mail_delivery WHERE reference_id COLLATE utf8mb4_unicode_ci IN "
                + "(SELECT id FROM task WHERE workspace_id = ?) OR reference_id COLLATE utf8mb4_unicode_ci IN "
                + "(SELECT id FROM demand WHERE workspace_id = ?)", bound.getSql().replaceAll("\\s+", " ").trim());
        assertEquals(2, bound.getParameterMappings().size());
        assertTrue(bound.getParameterMappings().stream().allMatch(mapping -> "workspaceId".equals(mapping.getProperty())));
    }

    private MailDelivery delivery(Long id, int attempts) {
        MailDelivery d = new MailDelivery();
        d.setId(id);
        d.setRecipient("u@example.com");
        d.setSubject("subject");
        d.setBody("body");
        d.setAttempts(attempts);
        d.setStatus("pending");
        return d;
    }
}
