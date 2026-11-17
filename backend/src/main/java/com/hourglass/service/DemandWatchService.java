package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.WorkspaceMember;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.DemandWatchMapper;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkspaceMemberMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 需求关注人（提醒人）：关注后状态流转、内容编辑、行内改优先级/期望交付、评论等事件会通知关注者。
 * 提交人默认接收通知，不占用关注名单；项目可写者可代他人添加/移除，关注者可自行取消关注。
 */
@Service
public class DemandWatchService {

    private static final Logger log = LoggerFactory.getLogger(DemandWatchService.class);

    private final DemandWatchMapper watchMapper;
    private final DemandMapper demandMapper;
    private final UserMapper userMapper;
    private final WorkspaceMemberMapper memberMapper;
    private final ProjectAccessService projectAccess;
    private final NotificationEventService notificationEvents;

    public DemandWatchService(DemandWatchMapper watchMapper, DemandMapper demandMapper,
                              UserMapper userMapper, WorkspaceMemberMapper memberMapper,
                              ProjectAccessService projectAccess, NotificationEventService notificationEvents) {
        this.watchMapper = watchMapper;
        this.demandMapper = demandMapper;
        this.userMapper = userMapper;
        this.memberMapper = memberMapper;
        this.projectAccess = projectAccess;
        this.notificationEvents = notificationEvents;
    }

    public Map<String, Object> status(String userId, String workspaceId, String demandId) {
        Demand d = requireDemand(workspaceId, demandId);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        Map<String, Object> res = new LinkedHashMap<String, Object>();
        res.put("watching", watchMapper.countMine(workspaceId, demandId, userId) > 0);
        res.put("count", watchMapper.selectUserIdsByDemand(workspaceId, demandId).size());
        res.put("canManage", projectAccess.canWrite(workspaceId, userId, d.getReqId()));
        res.put("creatorId", d.getCreatedBy());
        res.put("creatorName", displayName(d.getCreatedBy()));
        res.put("watchers", watchMapper.selectViewers(workspaceId, demandId));
        return res;
    }

    @Transactional
    public Map<String, Object> watch(String userId, String workspaceId, String demandId) {
        Demand d = requireDemand(workspaceId, demandId);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        /* 提交人默认就收通知，不进名单：否则名单里会出现两条自己，而且取消后仍会收到 */
        if (!userId.equals(d.getCreatedBy())) {
            watchMapper.insertIgnore(workspaceId, demandId, userId, userId);
        }
        return status(userId, workspaceId, demandId);
    }

    @Transactional
    public Map<String, Object> unwatch(String userId, String workspaceId, String demandId) {
        Demand d = requireDemand(workspaceId, demandId);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        watchMapper.delete(workspaceId, demandId, userId);
        return status(userId, workspaceId, demandId);
    }

    /** 代他人添加：需项目写权限；提交人已默认接收通知，不再进入关注名单。 */
    @Transactional
    public Map<String, Object> addWatcher(String userId, String workspaceId, String demandId, String targetUserId) {
        Demand d = requireDemand(workspaceId, demandId);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        String target = Texts.trimToNull(targetUserId);
        if (target == null) {
            throw AppException.badRequest("请选择提醒人");
        }
        if (target.equals(d.getCreatedBy())) {
            throw AppException.badRequest("提交人默认接收通知，无需添加为提醒人");
        }
        requireWatchable(d, target);
        watchMapper.insertIgnore(workspaceId, demandId, target, userId);
        return status(userId, workspaceId, demandId);
    }

    /** 创建需求时预置提醒人：与逐个添加同一套校验；提交人、空值与重复项跳过。 */
    @Transactional
    public void addWatchers(Demand d, String actorId, Collection<String> targetIds) {
        if (targetIds == null || targetIds.isEmpty()) {
            return;
        }
        Set<String> seen = new LinkedHashSet<String>();
        for (String raw : targetIds) {
            String target = Texts.trimToNull(raw);
            if (target == null || target.equals(actorId) || target.equals(d.getCreatedBy())
                    || !seen.add(target)) {
                continue;
            }
            requireWatchable(d, target);
            watchMapper.insertIgnore(d.getWorkspaceId(), d.getId(), target, actorId);
        }
    }

    private void requireWatchable(Demand d, String target) {
        WorkspaceMember member = memberMapper.selectMember(d.getWorkspaceId(), target);
        if (member == null) {
            throw AppException.badRequest("提醒人不是当前空间成员");
        }
        if (!projectAccess.canView(d.getWorkspaceId(), target, d.getReqId())) {
            throw AppException.badRequest("提醒人对该项目不可见，无法接收需求通知");
        }
    }

    /** 移除提醒人：本人可取消关注，项目可写者可移除他人。 */
    @Transactional
    public Map<String, Object> removeWatcher(String userId, String workspaceId, String demandId,
                                             String targetUserId) {
        Demand d = requireDemand(workspaceId, demandId);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        String target = Texts.trimToNull(targetUserId);
        if (target == null) {
            throw AppException.badRequest("请选择要移除的提醒人");
        }
        if (!target.equals(userId)) {
            projectAccess.assertWrite(workspaceId, userId, d.getReqId());
        }
        watchMapper.delete(workspaceId, demandId, target);
        return status(userId, workspaceId, demandId);
    }

    /** 需求删除时清关注名单（关注行是需求的从属数据） */
    public void clear(String workspaceId, String demandId) {
        watchMapper.deleteByDemand(workspaceId, demandId);
    }

    /** 关注人 ID 列表；表缺失/读取异常只返回空，不影响主业务通知 */
    public List<String> watcherIds(String workspaceId, String demandId) {
        try {
            return watchMapper.selectUserIdsByDemand(workspaceId, demandId);
        } catch (Exception e) {
            log.warn("读取需求关注人失败（不影响主业务）：workspace={} demand={}", workspaceId, demandId, e);
            return Collections.emptyList();
        }
    }

    /** 给关注者投递带详情深链的通知；已单独通知过的人由调用方放进 skip，避免重复。 */
    public void notifyWatchers(Demand d, String actorId, String eventType,
                               String title, String body, Collection<String> skip) {
        notifyWatchers(watcherIds(d.getWorkspaceId(), d.getId()), d, actorId, eventType, title, body, skip, true);
    }

    /**
     * @param linked 需求删除后详情已不存在，必须传 false，避免通知中心留下死链。
     * @param ids    预取的关注人 ID：删除流程会在同一事务内清表，必须提前读取。
     */
    public void notifyWatchers(List<String> ids, Demand d, String actorId, String eventType,
                               String title, String body, Collection<String> skip, boolean linked) {
        for (String watcherId : ids) {
            if (watcherId == null || watcherId.equals(actorId)
                    || (skip != null && skip.contains(watcherId))) {
                continue;
            }
            if (linked) {
                notificationEvents.notifyLinked(watcherId, d.getWorkspaceId(), eventType, title, body,
                        "demand", d.getId(), d.getReqId());
            } else {
                notificationEvents.notifyLinked(watcherId, d.getWorkspaceId(), eventType, title, body,
                        null, null, d.getReqId());
            }
        }
    }

    private String displayName(String userId) {
        if (userId == null) {
            return null;
        }
        AppUser user = userMapper.selectById(userId);
        return user == null ? null : user.getDisplayName();
    }

    private Demand requireDemand(String workspaceId, String demandId) {
        Demand d = demandMapper.selectById(demandId);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + demandId);
        }
        return d;
    }
}
