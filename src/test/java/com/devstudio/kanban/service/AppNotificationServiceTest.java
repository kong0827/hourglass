package com.devstudio.kanban.service;

import com.devstudio.kanban.mapper.AppNotificationMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class AppNotificationServiceTest {

    @Test
    void purgeUsesConfiguredRetainDays() {
        AppNotificationMapper mapper = mock(AppNotificationMapper.class);
        AppNotificationService service = new AppNotificationService(mapper);
        ReflectionTestUtils.setField(service, "retainDays", 7);
        LocalDateTime expected = LocalDateTime.now().minusDays(7);

        service.purgeExpired();

        ArgumentCaptor<LocalDateTime> cutoff = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(mapper).deleteOlderThan(cutoff.capture());
        assertEquals(expected.toLocalDate(), cutoff.getValue().toLocalDate());
    }
}
