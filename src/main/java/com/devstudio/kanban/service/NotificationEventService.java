package com.devstudio.kanban.service;

import com.devstudio.kanban.dto.NotificationPreferenceItem;
import com.devstudio.kanban.entity.AppUser;
import com.devstudio.kanban.mapper.UserMapper;
import com.devstudio.kanban.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** 同一业务事件按个人偏好同时投递站内通知与邮件 outbox。 */
@Service
public class NotificationEventService {

    private static final Logger log = LoggerFactory.getLogger(NotificationEventService.class);

    private final UserNotificationPreferenceService preferenceService;
    private final AppNotificationService inAppService;
    private final UserMapper userMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final MailDeliveryService mailDeliveryService;
    private final ProjectAccessService projectAccess;

    public NotificationEventService(UserNotificationPreferenceService preferenceService,
                                    AppNotificationService inAppService, UserMapper userMapper,
                                    WorkspaceMemberMapper memberMapper, MailDeliveryService mailDeliveryService,
                                    ProjectAccessService projectAccess) {
        this.preferenceService = preferenceService;
        this.inAppService = inAppService;
        this.userMapper = userMapper;
        this.memberMapper = memberMapper;
        this.mailDeliveryService = mailDeliveryService;
        this.projectAccess = projectAccess;
    }

    public void notify(String recipientUserId, String workspaceId, String eventType,
                       String title, String body, String referenceId) {
        notify(recipientUserId, workspaceId, eventType, title, body, referenceId, null);
    }

    /**
     * 投递事件通知。
     *
     * @param targetReqId 业务对象所属项目；接收人对该项目不可见（被设为"不可见"）时不投递，
     *                    避免撤销项目权限后仍通过站内信/邮件拿到对象内容。null 表示无项目归属。
     */
    public void notify(String recipientUserId, String workspaceId, String eventType,
                       String title, String body, String referenceId, String targetReqId) {
        if (recipientUserId == null) {
            return;
        }
        try {
            if (workspaceId == null || memberMapper.selectMember(workspaceId, recipientUserId) == null) {
                return;
            }
        } catch (Exception e) {
            log.warn("校验通知接收人空间成员失败（不影响主业务）：user={} workspace={}", recipientUserId, workspaceId, e);
            return;
        }
        try {
            if (!projectAccess.canView(workspaceId, recipientUserId, targetReqId)) {
                return;
            }
        } catch (Exception e) {
            log.warn("校验通知接收人项目可见范围失败（不影响主业务）：user={} workspace={} req={}",
                    recipientUserId, workspaceId, targetReqId, e);
            return;
        }
        NotificationPreferenceItem preference;
        try {
            preference = preferenceService.get(recipientUserId, eventType);
        } catch (Exception e) {
            log.warn("读取通知偏好失败（不影响主业务）：user={} event={}", recipientUserId, eventType, e);
            return;
        }
        if (Boolean.TRUE.equals(preference.getInApp())) {
            inAppService.pushImmediate(recipientUserId, workspaceId, eventType, title, body, referenceId);
        }
        if (Boolean.TRUE.equals(preference.getEmail())) {
            try {
                AppUser user = userMapper.selectById(recipientUserId);
                if (user != null) {
                    mailDeliveryService.enqueue(user.getEmail(), title, body, eventType, referenceId);
                }
            } catch (Exception e) {
                log.warn("事件邮件入队失败（不影响主业务）：user={} event={}", recipientUserId, eventType, e);
            }
        }
    }
}
