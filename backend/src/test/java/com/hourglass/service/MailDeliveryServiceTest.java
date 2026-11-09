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
        doThrow(new IllegalStateException("still down")).when(smtp)
                .send("u@example.com", "subject", "body");

        service.dispatchDue();

        verify(mapper).markAttemptFailed(2L, "failed", 3, null, "still down");
    }

    @Test
    void disabledSmtpLeavesOutboxUntouched() {
        when(smtp.isEnabled()).thenReturn(false);

        service.dispatchDue();

        verify(mapper, never()).selectDue(any(), anyInt());
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
