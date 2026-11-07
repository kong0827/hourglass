package com.hourglass.service;

import com.hourglass.common.CurrentUser;
import com.hourglass.common.Texts;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.WorkActivity;
import com.hourglass.mapper.UserMapper;
import com.hourglass.mapper.WorkActivityMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;

/** 通用业务实体活动轨迹，独立于任务日志与空间活动流。 */
@Service
public class WorkActivityService {

    public static final String PROJECT = "project";
    public static final String REQUIREMENT_DOC = "requirement_doc";

    private static final Logger log = LoggerFactory.getLogger(WorkActivityService.class);
    private static final int ACTOR_NAME_MAX = 64;
    private static final int DETAIL_MAX = 1000;
    private static final int LIST_LIMIT = 200;

    private final WorkActivityMapper activityMapper;
    private final UserMapper userMapper;

    public WorkActivityService(WorkActivityMapper activityMapper, UserMapper userMapper) {
        this.activityMapper = activityMapper;
        this.userMapper = userMapper;
    }

    /** 记录活动并保存操作人名称快照；日志异常不阻断已完成的业务操作。 */
    public void record(String workspaceId, String entityType, String entityId,
                       String actorId, String action, String detail) {
        try {
            AppUser actor = actorId == null ? null : userMapper.selectById(actorId);
            String actorName = actor == null ? null : Texts.trimToNull(actor.getDisplayName());
            if (actorName == null && actor != null) {
                actorName = Texts.trimToNull(actor.getUsername());
            }
            WorkActivity activity = new WorkActivity();
            activity.setWorkspaceId(workspaceId);
            activity.setEntityType(entityType);
            activity.setEntityId(entityId);
            activity.setActorId(actorId);
            activity.setActorName(Texts.cut(actorName, ACTOR_NAME_MAX));
            activity.setAction(action);
            activity.setDetail(Texts.cut(detail, DETAIL_MAX));
            activityMapper.insert(activity);
        } catch (Exception e) {
            log.warn("业务活动写入失败（workspace={}, entityType={}, entityId={}）",
                    workspaceId, entityType, entityId, e);
        }
    }

    /** 使用当前登录人记录活动，供没有显式传递操作人的既有服务入口使用。 */
    public void recordCurrent(String workspaceId, String entityType, String entityId,
                              String action, String detail) {
        String actorId = null;
        try {
            actorId = CurrentUser.id();
        } catch (Exception ignored) {
            // 启动期或内部调用没有请求上下文时，保留空操作人。
        }
        record(workspaceId, entityType, entityId, actorId, action, detail);
    }

    /** 按实体倒序查询，固定最多返回 200 条。 */
    public List<WorkActivity> listByEntity(String workspaceId, String entityType, String entityId) {
        return activityMapper.selectByEntity(workspaceId, entityType, entityId, LIST_LIMIT);
    }

    /** 空间级文档动态流（联出文档标题等展示字段），草稿/隐藏项目过滤由文档服务按查看人做 */
    public List<com.hourglass.dto.ReqDocActivityView> docActivities(String workspaceId, int limit) {
        return activityMapper.selectDocActivities(workspaceId, REQUIREMENT_DOC, limit);
    }

    /** 实体删除时清掉它的活动轨迹，避免同 ID 重建后混入旧历史。 */
    public void deleteByEntity(String workspaceId, String entityType, String entityId) {
        activityMapper.deleteByEntity(workspaceId, entityType, entityId);
    }

    public void deleteAllByWorkspace(String workspaceId) {
        activityMapper.deleteAllByWorkspace(workspaceId);
    }
}
