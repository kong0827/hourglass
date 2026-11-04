package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.NotificationPreferenceItem;
import com.devstudio.kanban.dto.NotificationPreferenceUpdateRequest;
import com.devstudio.kanban.mapper.UserNotificationPreferenceMapper;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;

class UserNotificationPreferenceServiceTest {

    private final UserNotificationPreferenceMapper mapper = mock(UserNotificationPreferenceMapper.class);
    private final UserNotificationPreferenceService service = new UserNotificationPreferenceService(mapper);

    @Test
    void missingRowsReturnFourDefaults() {
        when(mapper.selectByUser("U1")).thenReturn(Collections.emptyList());

        List<NotificationPreferenceItem> result = service.list("U1");

        assertEquals(UserNotificationPreferenceService.EVENT_TYPES.size(), result.size());
        for (int i = 0; i < result.size(); i++) {
            assertEquals(UserNotificationPreferenceService.EVENT_TYPES.get(i), result.get(i).getEventType());
            assertTrue(result.get(i).getInApp());
            assertFalse(result.get(i).getEmail());
        }
    }

    @Test
    void updateRejectsUnknownEventBeforeWriting() {
        NotificationPreferenceUpdateRequest req = new NotificationPreferenceUpdateRequest();
        req.setPreferences(Collections.singletonList(new NotificationPreferenceItem("unknown", true, true)));

        AppException error = assertThrows(AppException.class, () -> service.update("U1", req));

        assertEquals(400, error.getCode());
        verify(mapper, never()).upsert(any());
    }
}
