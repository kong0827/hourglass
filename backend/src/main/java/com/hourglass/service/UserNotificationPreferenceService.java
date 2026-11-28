package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.dto.NotificationPreferenceItem;
import com.hourglass.dto.NotificationPreferenceUpdateRequest;
import com.hourglass.entity.UserNotificationPreference;
import com.hourglass.mapper.UserNotificationPreferenceMapper;
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

/** 个人事件偏好。缺省：站内开启、邮件关闭（被点名的文档 @ 提及例外，邮件默认开启）。 */
@Service
public class UserNotificationPreferenceService {

    public static final String TASK_ASSIGNED = "task_assigned";
    public static final String TASK_UPDATED = "task_updated";
    /** 评论与@共用：任务新评论、评论中被 @ 提及 */
    public static final String TASK_COMMENT = "task_comment";
    /** 我关注的任务：新评论、列流转、移入回收站/恢复（独立于评论与任务变更开关） */
    public static final String TASK_WATCH = "task_watch";
    /** 需求与版本动态：需求状态、需求文档、分支状态、版本发布/删除合并为一个开关 */
    public static final String DEMAND_STATUS = "demand_status";
    /** 我关注的需求：状态流转、内容编辑、行内优先级/期望交付调整与新评论（独立于需求动态开关） */
    public static final String DEMAND_WATCH = "demand_watch";
    /** 每日站内汇总开关（只影响 task_due 汇总，不影响任务级提醒） */
    public static final String DAILY_DIGEST = "daily_digest";
    /** 测试计划指派：执行人变更后进入「我的工作 → 待我执行」 */
    public static final String TEST_PLAN_ASSIGNED = "test_plan_assigned";
    /** 发布准备：负责人收到推送、T-7/T-3/T-1 待确认汇总 */
    public static final String RELEASE_PREP = "release_prep";
    /** 我关注的发布计划：改期、范围变化、进入就绪与 T-0 发布日 */
    public static final String RELEASE_WATCH = "release_watch";
    /** 文档 @ 提及：需求文档（含表格）正文里被 @；邮件默认开启，因为被点名通常需要尽快知道 */
    public static final String DOC_MENTION = "doc_mention";

    public static final List<String> EVENT_TYPES = Collections.unmodifiableList(Arrays.asList(
            TASK_ASSIGNED, TASK_COMMENT, TASK_WATCH, TASK_UPDATED, DEMAND_STATUS, DEMAND_WATCH,
            TEST_PLAN_ASSIGNED, RELEASE_PREP, RELEASE_WATCH, DAILY_DIGEST, DOC_MENTION));
    private static final Set<String> EVENT_SET = Collections.unmodifiableSet(new HashSet<String>(EVENT_TYPES));
    /** 邮件默认开启的事件（其余事件缺省只开站内）；用户显式保存过偏好后以其选择为准 */
    private static final Set<String> EMAIL_DEFAULT_ON =
            Collections.unmodifiableSet(new HashSet<String>(Arrays.asList(DOC_MENTION)));
    /** 企微应用消息只覆盖这三类事件，与 WeComNotifyService 的推送范围一致 */
    private static final Set<String> WECOM_EVENTS = Collections.unmodifiableSet(new HashSet<String>(
            Arrays.asList(TASK_ASSIGNED, TEST_PLAN_ASSIGNED, RELEASE_PREP)));

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
                    emailEnabled(p, eventType), wecomEnabled(p, eventType)));
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
            p.setWecomEnabled(WECOM_EVENTS.contains(item.getEventType())
                    ? (item.getWecom() == null ? Boolean.TRUE : item.getWecom())
                    : null);
            mapper.upsert(p);
        }
        return list(userId);
    }

    public NotificationPreferenceItem get(String userId, String eventType) {
        requireSupported(eventType);
        UserNotificationPreference p = mapper.selectOne(userId, eventType);
        return new NotificationPreferenceItem(eventType,
                p == null || p.getInAppEnabled() == null || Boolean.TRUE.equals(p.getInAppEnabled()),
                emailEnabled(p, eventType), wecomEnabled(p, eventType));
    }

    private static boolean emailEnabled(UserNotificationPreference p, String eventType) {
        if (p == null) {
            return EMAIL_DEFAULT_ON.contains(eventType);
        }
        return Boolean.TRUE.equals(p.getEmailEnabled());
    }

    /** 不支持企微的事件返回 null；支持的事件缺省开启（与升级前「送达后自动推企微」一致） */
    private static Boolean wecomEnabled(UserNotificationPreference p, String eventType) {
        if (!WECOM_EVENTS.contains(eventType)) {
            return null;
        }
        if (p == null || p.getWecomEnabled() == null) {
            return Boolean.TRUE;
        }
        return p.getWecomEnabled();
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
