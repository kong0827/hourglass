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

/** 个人事件偏好。缺省：站内开启、邮件关闭。 */
@Service
public class UserNotificationPreferenceService {

    public static final String TASK_ASSIGNED = "task_assigned";
    public static final String TASK_UPDATED = "task_updated";
    /** 评论与@共用：任务新评论、评论中被 @ 提及 */
    public static final String TASK_COMMENT = "task_comment";
    /** 我关注的任务：新评论、移入回收站/恢复（独立于评论与任务变更开关） */
    public static final String TASK_WATCH = "task_watch";
    /** 需求与版本动态：需求状态、需求文档、分支状态、版本发布/删除合并为一个开关 */
    public static final String DEMAND_STATUS = "demand_status";
    /** 每日站内汇总开关（只影响 task_due 汇总，不影响任务级提醒） */
    public static final String DAILY_DIGEST = "daily_digest";

    public static final List<String> EVENT_TYPES = Collections.unmodifiableList(Arrays.asList(
            TASK_ASSIGNED, TASK_COMMENT, TASK_WATCH, TASK_UPDATED, DEMAND_STATUS, DAILY_DIGEST));
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

    /** 读不到偏好时按开启处理：汇总属于低频增强，不应因一次读失败静默丢失 */
    public boolean inAppEnabled(String userId, String eventType) {
        try {
            return Boolean.TRUE.equals(get(userId, eventType).getInApp());
        } catch (Exception e) {
            return true;
        }
    }

    public static void requireSupported(String eventType) {
        if (eventType == null || !EVENT_SET.contains(eventType)) {
            throw AppException.badRequest("不支持的通知事件：" + eventType);
        }
    }
}
