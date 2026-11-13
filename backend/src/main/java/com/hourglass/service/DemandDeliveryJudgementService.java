package com.hourglass.service;

import com.hourglass.common.AppException;
import com.hourglass.common.Texts;
import com.hourglass.dto.DemandDeliveryJudgementRequest;
import com.hourglass.dto.PageResult;
import com.hourglass.entity.AppUser;
import com.hourglass.entity.Demand;
import com.hourglass.entity.DemandDeliveryJudgement;
import com.hourglass.mapper.DemandDeliveryJudgementMapper;
import com.hourglass.mapper.DemandMapper;
import com.hourglass.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 需求人工交付判定：补录缺失证据，不覆盖自动派生字段。
 *
 * <p>真实发布证据始终优先；没有真实发布时才采用人工“已交付”的生效日期。
 * 修改判定采用“撤销旧记录 + 新增记录”，保留完整历史；撤销后恢复自动派生结果。
 * 判定绑定当时的目标版本，需求换版本后旧判定不再参与派生。
 */
@Service
public class DemandDeliveryJudgementService {

    private static final int MAX_PAGE_SIZE = 100;

    private final DemandMapper demandMapper;
    private final DemandDeliveryJudgementMapper judgementMapper;
    private final UserMapper userMapper;
    private final ProjectAccessService projectAccess;
    private final ReleasePermissionService releasePermission;
    private final DeliveryScopeLock deliveryLock;

    public DemandDeliveryJudgementService(DemandMapper demandMapper,
                                          DemandDeliveryJudgementMapper judgementMapper,
                                          UserMapper userMapper, ProjectAccessService projectAccess,
                                          ReleasePermissionService releasePermission,
                                          DeliveryScopeLock deliveryLock) {
        this.demandMapper = demandMapper;
        this.judgementMapper = judgementMapper;
        this.userMapper = userMapper;
        this.projectAccess = projectAccess;
        this.releasePermission = releasePermission;
        this.deliveryLock = deliveryLock;
    }

    /** 新建或替换当前判定：旧记录自动撤销，新记录追加。 */
    @Transactional
    public void judge(String userId, String workspaceId, String id, DemandDeliveryJudgementRequest body) {
        String stage = body == null ? null : Texts.trimToNull(body.getStage());
        if (!"donePending".equals(stage) && !"delivered".equals(stage)) {
            throw AppException.badRequest("请选择人工判定阶段");
        }
        LocalDate effectiveOn = body.getEffectiveOn();
        if (effectiveOn == null) {
            throw AppException.badRequest("请选择判定生效日期");
        }
        if (effectiveOn.isAfter(LocalDate.now())) {
            throw AppException.badRequest("判定生效日期不能晚于今天");
        }
        String reason = requireReason(body.getNote());
        Demand demand = lockManageableDemand(userId, workspaceId, id, body.getRevision());
        if (!"plan".equals(demand.getStatus())) {
            throw AppException.badRequest("只有已排期需求可以维护人工交付判定");
        }

        DemandDeliveryJudgement active = judgementMapper.selectActive(workspaceId, id);
        if (active != null) {
            if (judgementMapper.revoke(active.getId(), userId, operatorName(userId),
                    "重新判定为" + stageName(stage)) != 1) {
                throw AppException.conflict("人工判定已被其他人修改，请刷新后重试");
            }
        }
        DemandDeliveryJudgement judgement = new DemandDeliveryJudgement();
        judgement.setWorkspaceId(workspaceId);
        judgement.setDemandId(id);
        judgement.setVersionId(demand.getVersionId());
        judgement.setJudgedStage(stage);
        judgement.setEffectiveOn(effectiveOn);
        judgement.setJudgeReason(reason);
        judgement.setJudgedByUserId(userId);
        judgement.setJudgedByName(operatorName(userId));
        judgementMapper.insert(judgement);
        demandMapper.insertLog(workspaceId, id, "judge_delivery",
                "人工判定为" + stageName(stage) + "（生效 " + effectiveOn + "）：" + reason, userId);
    }

    /** 撤销当前判定：保留历史，派生态立即回落到真实证据。 */
    @Transactional
    public void revoke(String userId, String workspaceId, String id, DemandDeliveryJudgementRequest body) {
        String reason = requireReason(body == null ? null : body.getNote());
        lockManageableDemand(userId, workspaceId, id, body.getRevision());
        DemandDeliveryJudgement active = judgementMapper.selectActive(workspaceId, id);
        if (active == null) {
            throw AppException.badRequest("当前没有生效的人工交付判定");
        }
        if (judgementMapper.revoke(active.getId(), userId, operatorName(userId), reason) != 1) {
            throw AppException.conflict("人工判定已被其他人撤销，请刷新后重试");
        }
        demandMapper.insertLog(workspaceId, id, "revoke_delivery_judgement",
                "撤销人工判定：" + reason, userId);
    }

    public PageResult<DemandDeliveryJudgement> history(String workspaceId, String userId, String id,
                                                       int offset, int limit) {
        Demand d = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        int safeOffset = Math.max(0, offset);
        int safeLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, limit));
        int total = judgementMapper.countHistory(workspaceId, id);
        List<DemandDeliveryJudgement> items = total <= safeOffset
                ? new ArrayList<DemandDeliveryJudgement>()
                : judgementMapper.selectHistory(workspaceId, id, safeOffset, safeLimit);
        return PageResult.of(items, total, safeOffset, safeLimit);
    }

    /**
     * 与排期写入同序：先读项目并校验管理权限，再锁项目、当前读需求、复核权限并用 revision 做并发校验。
     */
    private Demand lockManageableDemand(String userId, String workspaceId, String id, Long revision) {
        Demand initial = requireDemand(workspaceId, id);
        projectAccess.assertView(workspaceId, userId, initial.getReqId());
        releasePermission.assertManageProject(userId, workspaceId, initial.getReqId());
        deliveryLock.lockProjects(workspaceId, initial.getReqId());
        Demand d = demandMapper.selectByIdForUpdate(workspaceId, id);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + id);
        }
        if (!Objects.equals(initial.getReqId(), d.getReqId())) {
            throw AppException.conflict("需求所属项目已变更，请刷新后重试");
        }
        projectAccess.assertView(workspaceId, userId, d.getReqId());
        releasePermission.assertManageProjectForUpdate(userId, workspaceId, d.getReqId());
        if (revision == null) {
            throw AppException.badRequest("请携带需求 revision，刷新后重试");
        }
        if (!revision.equals(d.getRevision())) {
            throw AppException.conflict("需求已被其他人修改，请刷新后重试");
        }
        return d;
    }

    private Demand requireDemand(String workspaceId, String id) {
        Demand d = demandMapper.selectById(id);
        if (d == null || !workspaceId.equals(d.getWorkspaceId())) {
            throw AppException.notFound("需求不存在：" + id);
        }
        return d;
    }

    private String requireReason(String note) {
        String reason = Texts.trimToNull(note);
        if (reason == null) {
            throw AppException.badRequest("请填写人工判定原因");
        }
        if (reason.length() > 500) {
            throw AppException.badRequest("人工判定原因不能超过 500 字");
        }
        return reason;
    }

    private String operatorName(String userId) {
        AppUser user = userMapper.selectById(userId);
        String name = user == null ? null : Texts.trimToNull(user.getDisplayName());
        return name == null ? userId : name;
    }

    private String stageName(String stage) {
        return "delivered".equals(stage) ? "已交付" : "已完成待发布";
    }
}
