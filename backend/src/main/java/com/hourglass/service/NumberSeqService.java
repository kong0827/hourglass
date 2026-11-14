package com.hourglass.service;

import com.hourglass.mapper.NumberSeqMapper;
import org.springframework.stereotype.Service;

/**
 * 人类可读编号的唯一取号入口（sql/87）。
 *
 * <p>取号只在 number_seq 上自增，不再看业务表的 MAX：删掉当前最大号的行，下一个也不会复用旧号。
 * 两步调用必须在调用方事务里完成，自增的行锁才会覆盖到读回（见 NumberSeqMapper.xml）。
 * 回滚会让序列停在原处（该号未发出），提交后不会倒退。
 */
@Service
public class NumberSeqService {

    static final String DEMAND = "demand";
    static final String CASE = "case";
    static final String PLAN = "plan";

    private final NumberSeqMapper mapper;

    public NumberSeqService(NumberSeqMapper mapper) {
        this.mapper = mapper;
    }

    public int nextDemand(String workspaceId, String projectId) {
        return next(workspaceId, DEMAND, projectId);
    }

    public int nextCase(String workspaceId, String projectId) {
        return next(workspaceId, CASE, projectId);
    }

    /** 计划跨项目、跨版本，序列按空间取，scope 为空串 */
    public int nextPlan(String workspaceId) {
        return next(workspaceId, PLAN, "");
    }

    /** 备份恢复后把项目内用例序列抬到已导入编号之上 */
    public void raiseCase(String workspaceId, String projectId, int lastNo) {
        if (lastNo > 0) {
            mapper.raiseTo(workspaceId, CASE, projectId, lastNo);
        }
    }

    public void raiseDemand(String workspaceId, String projectId, int lastNo) {
        if (lastNo > 0) {
            mapper.raiseTo(workspaceId, DEMAND, projectId, lastNo);
        }
    }

    private int next(String workspaceId, String kind, String scopeId) {
        mapper.bump(workspaceId, kind, scopeId);
        Integer no = mapper.selectNext(workspaceId, kind, scopeId);
        if (no == null) {
            throw new IllegalStateException("编号序列读取失败：" + kind + "/" + scopeId);
        }
        return no;
    }
}
