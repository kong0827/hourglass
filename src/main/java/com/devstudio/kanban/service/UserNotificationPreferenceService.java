package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AppException;
import com.devstudio.kanban.dto.NotificationPreferenceItem;
import com.devstudio.kanban.dto.NotificationPreferenceUpdateRequest;
import com.devstudio.kanban.entity.UserNotificationPreference;
import com.devstudio.kanban.mapper.UserNotificationPreferenceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 固定四类个人事件偏好。缺省：站内开启、邮件关闭。 */
@Service
public class UserNotificationPreferenceService {

    public static final String TASK_ASSIGNED = "task_assigned";
    public static final String TASK_UPDATED = "task_updated";
    public static final String TASK_COMMENT = "task_comment";
    public static final String DEMAND_STATUS = "demand_status";

    public static final List<String> EVENT_TYPES = Collections.unmodifiableList(Arrays.asList(
            TASK_ASSIGNED, TASK_UPDATED, TASK_COMMENT, DEMAND_STATUS));
    private static final Set<String> EVENT_SET = Collections.unmodifiableSet(new HashSet<String>(EVENT_TYPES));

    private final UserNotificationPreferenceMapper mapper;

    public UserNotificationPreferenceService(UserNotificationPreferenceMapper mapper) {
        this.mapper = mapper;
    }

    public List<NotificationPreferenceItem> list(String userId) {
        Map<String, UserNotificationPreference> saved = new HashMap<String, UserNotificationPreference>();
        for (UserNotificationPreference p : mapper.selectByUser(userId)) {
            saved.put(p.getEventType(), p);
        }
        List<NotificationPreferenceItem> result = new ArrayList<NotificationPreferenceItem>();
        for (String eventType : EVENT_TYPES) {
            UserNotificationPreference p = saved.get(eventType);
            result.add(new NotificationPreferenceItem(eventType,
                    p == null || p.getInAppEnabled() == null || Boolean.TRUE.equals(p.getInAppEnabled()),
                    p != null && Boolean.TRUE.equals(p.getEmailEnabled())));
        }
        return result;
    }

    @Transactional
    public List<NotificationPreferenceItem> update(String userId, NotificationPreferenceUpdateRequest req) {
        Set<String> seen = new HashSet<String>();
        for (NotificationPreferenceItem item : req.getPreferences()) {
            requireSupported(item.getEventType());
            if (!seen.add(item.getEventType())) {
                throw AppException.badRequest("通知事件重复：" + item.getEventType());
            }
            UserNotificationPreference p = new UserNotificationPreference();
            p.setUserId(userId);
            p.setEventType(item.getEventType());
            p.setInAppEnabled(item.getInApp());
            p.setEmailEnabled(item.getEmail());
            mapper.upsert(p);
        }
        return list(userId);
    }

    public NotificationPreferenceItem get(String userId, String eventType) {
        requireSupported(eventType);
        UserNotificationPreference p = mapper.selectOne(userId, eventType);
        return new NotificationPreferenceItem(eventType,
                p == null || p.getInAppEnabled() == null || Boolean.TRUE.equals(p.getInAppEnabled()),
                p != null && Boolean.TRUE.equals(p.getEmailEnabled()));
    }

    public static void requireSupported(String eventType) {
        if (eventType == null || !EVENT_SET.contains(eventType)) {
            throw AppException.badRequest("不支持的通知事件：" + eventType);
        }
    }
}
