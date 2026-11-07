package com.hourglass.service;

import com.hourglass.common.Texts;
import com.hourglass.dto.NotificationPreferenceItem;
import com.hourglass.entity.AppUser;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** 同一业务事件按个人偏好同时投递站内通知与邮件 outbox。 */
@Service
public class NotificationEventService {

    private static final Logger log = LoggerFactory.getLogger(NotificationEventService.class);

    /** 系统/安全通知：不受个人偏好控制，始终尝试投递站内与邮件 */
    public static final String PROJECT_ACCESS = "project_access";
    public static final String MEMBER_ROLE = "member_role";
    public static final String MEMBER_REMOVED = "member_removed";

    /** 只有任务类事件能拼出可用的深链（需求/文档/分支的详情路由不同） */
    private static final Set<String> TASK_LINK_EVENTS = Collections.unmodifiableSet(new HashSet<String>(Arrays.asList(
            UserNotificationPreferenceService.TASK_ASSIGNED,
            UserNotificationPreferenceService.TASK_UPDATED,
            UserNotificationPreferenceService.TASK_COMMENT,
            UserNotificationPreferenceService.TASK_WATCH)));

    /** 站点根地址（含 context-path，如 https://host/hourglass/）；为空时邮件不附链接 */
    @Value("${app.mail.base-url:}")
    private String mailBaseUrl;

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
            enqueueMail(recipientUserId, eventType, title, body, referenceId);
        }
    }

    /**
     * 系统/安全通知：用于「收件人刚被移出空间」或「项目可见范围刚被收回」这类场景。
     * 不能复用 {@link #notify}——成员校验与项目可见性校验会把通知本身拦掉。
     * 不经个人偏好开关，站内必投；邮件在收件人有邮箱且 SMTP 已启用时投递。
     */
    public void notifySystem(String recipientUserId, String workspaceId, String eventType,
                             String title, String body, String referenceId) {
        if (recipientUserId == null || workspaceId == null) {
            return;
        }
        try {
            inAppService.pushImmediate(recipientUserId, workspaceId, eventType, title, body, referenceId);
        } catch (Exception e) {
            log.warn("系统站内通知写入失败（不影响主业务）：user={} event={}", recipientUserId, eventType, e);
        }
        enqueueMail(recipientUserId, eventType, title, body, referenceId);
    }

    private void enqueueMail(String recipientUserId, String eventType,
                             String title, String body, String referenceId) {
        try {
            AppUser user = userMapper.selectById(recipientUserId);
            if (user != null) {
                mailDeliveryService.enqueue(user.getEmail(), title,
                        withTaskLink(body, eventType, referenceId), eventType, referenceId);
            }
        } catch (Exception e) {
            log.warn("事件邮件入队失败（不影响主业务）：user={} event={}", recipientUserId, eventType, e);
        }
    }

    /** 邮件里直接给出任务深链；未配置 base-url 时保持纯文本，避免出现半截地址 */
    private String withTaskLink(String body, String eventType, String referenceId) {
        if (referenceId == null || !TASK_LINK_EVENTS.contains(eventType)) {
            return body;
        }
        String base = Texts.trimToNull(mailBaseUrl);
        if (base == null) {
            return body;
        }
        if (!base.endsWith("/")) {
            base = base + "/";
        }
        return body + "\n\n打开任务：" + base + "#/board?task=" + referenceId;
    }
}
