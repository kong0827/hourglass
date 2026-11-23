package com.hourglass.service;

import com.hourglass.common.Texts;
import com.hourglass.dto.NotificationPreferenceItem;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMapper;
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

    /** @ 提及使用独立通知类型，便于「提及我」筛选与计数；个人偏好仍沿用评论开关。 */
    public static final String MENTION_TYPE = "task_mention";

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
    private final WorkspaceMapper workspaceMapper;

    public NotificationEventService(UserNotificationPreferenceService preferenceService,
                                    AppNotificationService inAppService, UserMapper userMapper,
                                    WorkspaceMemberMapper memberMapper, MailDeliveryService mailDeliveryService,
                                    ProjectAccessService projectAccess, WorkspaceMapper workspaceMapper) {
        this.preferenceService = preferenceService;
        this.inAppService = inAppService;
        this.userMapper = userMapper;
        this.memberMapper = memberMapper;
        this.mailDeliveryService = mailDeliveryService;
        this.projectAccess = projectAccess;
        this.workspaceMapper = workspaceMapper;
    }

    public void notify(String recipientUserId, String workspaceId, String eventType,
                       String title, String body, String referenceId) {
        notify(recipientUserId, workspaceId, eventType, title, body, referenceId, null);
    }

    /** 投递任务类事件通知（referenceId 为任务 ID）。 */
    public void notify(String recipientUserId, String workspaceId, String eventType,
                       String title, String body, String referenceId, String targetReqId) {
        deliver(recipientUserId, workspaceId, eventType, title, body, referenceId, null, null, targetReqId);
    }

    /**
     * 投递 @ 提及通知：站内类型为 {@link #MENTION_TYPE}，偏好与邮件链接仍按评论事件处理。
     * 这样「提及我」筛选能命中，同时不新增一个需要用户单独配置的偏好项。
     */
    public void notifyMention(String recipientUserId, String workspaceId, String title, String body,
                              String referenceId, String targetReqId) {
        deliver(recipientUserId, workspaceId, UserNotificationPreferenceService.TASK_COMMENT, MENTION_TYPE,
                title, body, referenceId, null, null, targetReqId);
    }

    /**
     * 投递非任务事件通知：refKind/refId 指向需求、文档、分支、版本等详情，通知中心可深链。
     * 邮件仍不带链接（只有任务有统一深链格式）。
     */
    /** @return false 表示投递过程出错；用于调用方决定是否撤回已写的去重记录。 */
    public boolean notifyLinked(String recipientUserId, String workspaceId, String eventType,
                                String title, String body, String refKind, String refId, String targetReqId) {
        return notifyLinked(recipientUserId, workspaceId, eventType, title, body,
                refKind, refId, targetReqId, null);
    }

    /**
     * @param mailSuffix 只追加到邮件的深链文本（站内正文不显示）；调用方负责在未配置
     *                   base-url 时传 null，避免邮件出现半截地址。
     */
    public boolean notifyLinked(String recipientUserId, String workspaceId, String eventType,
                                String title, String body, String refKind, String refId,
                                String targetReqId, String mailSuffix) {
        return deliver(recipientUserId, workspaceId, eventType, eventType, title, body,
                null, refKind, refId, targetReqId, true, mailSuffix).ok;
    }

    /** 事件偏好与通知中心类型分开：如版本发布沿用「需求与版本动态」偏好，但按「发布」分类展示。 */
    public void notifyLinkedAs(String recipientUserId, String workspaceId, String eventType,
                               String notificationType, String title, String body,
                               String refKind, String refId, String targetReqId) {
        deliver(recipientUserId, workspaceId, eventType, notificationType, title, body, null, refKind, refId, targetReqId);
    }

    /**
     * 汇总类提醒：没有单一任务/对象，但需要按个人偏好投递站内与邮件。
     * refKind/refId 只用于通知中心打开对应页面（如 mywork）。
     *
     * @return 是否真的投递出至少一个渠道（站内写入或邮件入队），供「提醒 N 人」如实计数
     */
    public boolean notifySummary(String recipientUserId, String workspaceId, String eventType,
                                 String notificationType, String title, String body,
                                 String refKind, String refId) {
        return notifySummary(recipientUserId, workspaceId, eventType, notificationType, title, body,
                refKind, refId, true);
    }

    /**
     * @param allowInApp 空间级站内通知关闭时传 false：保留邮件，不写通知中心，
     *                   与周报等订阅报告的渠道口径一致。
     */
    public boolean notifySummary(String recipientUserId, String workspaceId, String eventType,
                                 String notificationType, String title, String body,
                                 String refKind, String refId, boolean allowInApp) {
        return deliver(recipientUserId, workspaceId, eventType, notificationType, title, body,
                null, refKind, refId, null, allowInApp).delivered;
    }

    /**
     * @param targetReqId 业务对象所属项目；接收人对该项目不可见（被设为"不可见"）时不投递，
     *                    避免撤销项目权限后仍通过站内信/邮件拿到对象内容。null 表示无项目归属。
     */
    private DeliveryOutcome deliver(String recipientUserId, String workspaceId, String eventType,
                                    String title, String body, String refTaskId, String refKind, String refId,
                                    String targetReqId) {
        return deliver(recipientUserId, workspaceId, eventType, eventType,
                title, body, refTaskId, refKind, refId, targetReqId, true);
    }

    private DeliveryOutcome deliver(String recipientUserId, String workspaceId, String eventType, String notificationType,
                                    String title, String body, String refTaskId, String refKind, String refId,
                                    String targetReqId) {
        return deliver(recipientUserId, workspaceId, eventType, notificationType, title, body,
                refTaskId, refKind, refId, targetReqId, true);
    }

    private DeliveryOutcome deliver(String recipientUserId, String workspaceId, String eventType, String notificationType,
                                    String title, String body, String refTaskId, String refKind, String refId,
                                    String targetReqId, boolean allowInApp) {
        return deliver(recipientUserId, workspaceId, eventType, notificationType, title, body,
                refTaskId, refKind, refId, targetReqId, allowInApp, null);
    }

    /**
     * @param eventType        决定个人偏好与邮件链接规则
     * @param notificationType 实际写入站内通知中心的类型（通常与 eventType 相同）
     * @param allowInApp       是否允许写站内通知；false 时仅按个人偏好投递邮件
     */
    private DeliveryOutcome deliver(String recipientUserId, String workspaceId, String eventType, String notificationType,
                                    String title, String body, String refTaskId, String refKind, String refId,
                                    String targetReqId, boolean allowInApp, String mailSuffix) {
        if (recipientUserId == null) {
            return DeliveryOutcome.NOTHING;
        }
        try {
            if (workspaceId == null || memberMapper.selectMember(workspaceId, recipientUserId) == null) {
                return DeliveryOutcome.NOTHING;
            }
        } catch (Exception e) {
            log.warn("校验通知接收人空间成员失败（不影响主业务）：user={} workspace={}", recipientUserId, workspaceId, e);
            return DeliveryOutcome.FAILED;
        }
        try {
            if (!projectAccess.canView(workspaceId, recipientUserId, targetReqId)) {
                return DeliveryOutcome.NOTHING;
            }
        } catch (Exception e) {
            log.warn("校验通知接收人项目可见范围失败（不影响主业务）：user={} workspace={} req={}",
                    recipientUserId, workspaceId, targetReqId, e);
            return DeliveryOutcome.FAILED;
        }
        NotificationPreferenceItem preference;
        try {
            preference = preferenceService.get(recipientUserId, eventType);
        } catch (Exception e) {
            log.warn("读取通知偏好失败（不影响主业务）：user={} event={}", recipientUserId, eventType, e);
            return DeliveryOutcome.FAILED;
        }
        boolean ok = true;
        boolean delivered = false;
        if (allowInApp && Boolean.TRUE.equals(preference.getInApp()) && inAppEnabled(workspaceId)) {
            AppNotificationService.PushResult result = inAppService.pushImmediate(recipientUserId,
                    workspaceId, notificationType, title, body, refTaskId, refKind, refId, targetReqId);
            if (result == AppNotificationService.PushResult.INSERTED) {
                delivered = true;
            } else {
                ok = false;
            }
        }
        if (Boolean.TRUE.equals(preference.getEmail())) {
            if (enqueueMail(recipientUserId, eventType, title, body, refTaskId, mailSuffix)) {
                delivered = true;
            } else {
                ok = false;
            }
        }
        return new DeliveryOutcome(ok, delivered);
    }

    /**
     * 系统/安全通知：用于「收件人刚被移出空间」或「项目可见范围刚被收回」这类场景。
     * 不能复用 {@link #notify}——成员校验与项目可见性校验会把通知本身拦掉。
     * 不经个人偏好开关，站内必投；邮件在收件人有邮箱且 SMTP 已启用时投递。
     */
    public void notifySystem(String recipientUserId, String workspaceId, String eventType,
                             String title, String body, String referenceId) {
        notifySystem(recipientUserId, workspaceId, eventType, title, body, referenceId, null, null);
    }

    /** 系统通知也可带非任务深链（如项目可见范围 → 项目驾驶舱、成员角色 → 设置页）。 */
    public void notifySystem(String recipientUserId, String workspaceId, String eventType,
                             String title, String body, String referenceId,
                             String refKind, String refId) {
        if (recipientUserId == null || workspaceId == null) {
            return;
        }
        try {
            inAppService.pushImmediate(recipientUserId, workspaceId, eventType, title, body,
                    referenceId, refKind, refId);
        } catch (Exception e) {
            log.warn("系统站内通知写入失败（不影响主业务）：user={} event={}", recipientUserId, eventType, e);
        }
        enqueueMail(recipientUserId, eventType, title, body, referenceId, null);
    }

    /**
     * 空间级「站内通知」开关（设置 → 通知）：关闭后事件类站内提醒一律不写通知中心，
     * 邮件仍按个人偏好投递。读取失败按开启处理，避免因配置读取异常静默丢通知。
     */
    private boolean inAppEnabled(String workspaceId) {
        if (workspaceId == null) {
            return true;
        }
        try {
            Workspace ws = workspaceMapper.selectById(workspaceId);
            return ws == null || !Boolean.FALSE.equals(ws.getNotifyInAppEnabled());
        } catch (Exception e) {
            log.warn("读取空间站内通知开关失败，按开启处理：workspace={}", workspaceId, e);
            return true;
        }
    }

    private boolean enqueueMail(String recipientUserId, String eventType,
                                String title, String body, String referenceId, String mailSuffix) {
        try {
            AppUser user = userMapper.selectById(recipientUserId);
            if (user != null) {
                String text = withTaskLink(body, eventType, referenceId)
                        + (mailSuffix == null ? "" : mailSuffix);
                return mailDeliveryService.enqueue(user.getEmail(), title,
                        text, eventType, referenceId);
            }
        } catch (Exception e) {
            log.warn("事件邮件入队失败（不影响主业务）：user={} event={}", recipientUserId, eventType, e);
        }
        return false;
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

    /** 投递结局：ok=过程无错（沿用旧布尔语义），delivered=确实写出至少一个渠道。 */
    private static final class DeliveryOutcome {
        static final DeliveryOutcome NOTHING = new DeliveryOutcome(true, false);
        static final DeliveryOutcome FAILED = new DeliveryOutcome(false, false);

        final boolean ok;
        final boolean delivered;

        DeliveryOutcome(boolean ok, boolean delivered) {
            this.ok = ok;
            this.delivered = delivered;
        }
    }
}
