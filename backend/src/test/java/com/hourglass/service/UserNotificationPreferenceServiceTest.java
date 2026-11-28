package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.NotificationPreferenceItem;
import com.hourglass.dto.NotificationPreferenceUpdateRequest;
import com.hourglass.mapper.UserNotificationPreferenceMapper;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
    void missingRowsReturnDefaultsWithDocMentionEmailOn() {
        when(mapper.selectByUser("U1")).thenReturn(Collections.emptyList());

        List<NotificationPreferenceItem> result = service.list("U1");

        assertEquals(UserNotificationPreferenceService.EVENT_TYPES.size(), result.size());
        for (int i = 0; i < result.size(); i++) {
            assertEquals(UserNotificationPreferenceService.EVENT_TYPES.get(i), result.get(i).getEventType());
            assertTrue(result.get(i).getInApp());
            boolean emailDefaultOn = UserNotificationPreferenceService.DOC_MENTION.equals(result.get(i).getEventType());
            assertEquals(emailDefaultOn, result.get(i).getEmail());
            /* 企微缺省只在指派/测试指派/发布准备三类开启，其余事件返回 null 表示不适用 */
            String type = result.get(i).getEventType();
            boolean wecomApplies = UserNotificationPreferenceService.TASK_ASSIGNED.equals(type)
                    || UserNotificationPreferenceService.TEST_PLAN_ASSIGNED.equals(type)
                    || UserNotificationPreferenceService.RELEASE_PREP.equals(type);
            assertEquals(wecomApplies ? Boolean.TRUE : null, result.get(i).getWecom());
        }
    }

    @Test
    void updateStoresWecomOnlyForPushableEvents() {
        NotificationPreferenceUpdateRequest req = new NotificationPreferenceUpdateRequest();
        req.setPreferences(java.util.Arrays.asList(
                new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_ASSIGNED, true, false, false),
                new NotificationPreferenceItem(UserNotificationPreferenceService.RELEASE_PREP, true, false),
                new NotificationPreferenceItem(UserNotificationPreferenceService.TASK_COMMENT, true, false)));
        when(mapper.selectByUser("U1")).thenReturn(Collections.emptyList());

        service.update("U1", req);

        org.mockito.ArgumentCaptor<com.hourglass.entity.UserNotificationPreference> captor =
                org.mockito.ArgumentCaptor.forClass(com.hourglass.entity.UserNotificationPreference.class);
        verify(mapper, org.mockito.Mockito.times(3)).upsert(captor.capture());
        /* 显式关闭写 false；推送事件未提交企微字段按开启；不支持的事件写 null */
        assertEquals(Boolean.FALSE, captor.getAllValues().get(0).getWecomEnabled());
        assertEquals(Boolean.TRUE, captor.getAllValues().get(1).getWecomEnabled());
        org.junit.jupiter.api.Assertions.assertNull(captor.getAllValues().get(2).getWecomEnabled());
    }

    @Test
    void wecomEnabledReadsRowAndDefaultsOn() {
        com.hourglass.entity.UserNotificationPreference row = new com.hourglass.entity.UserNotificationPreference();
        row.setEventType(UserNotificationPreferenceService.RELEASE_PREP);
        row.setWecomEnabled(Boolean.FALSE);
        when(mapper.selectOne("U1", UserNotificationPreferenceService.RELEASE_PREP)).thenReturn(row);

        assertEquals(false, service.wecomEnabled("U1", UserNotificationPreferenceService.RELEASE_PREP));

        row.setWecomEnabled(null);
        /* 列值为空表示升级前存量，按开启处理 */
        assertEquals(true, service.wecomEnabled("U1", UserNotificationPreferenceService.RELEASE_PREP));
        assertEquals(false, service.wecomEnabled("U1", UserNotificationPreferenceService.TASK_COMMENT));
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
