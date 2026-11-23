package com.hourglass.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;

/** 自动化去重台账：唯一键冲突即表示同一天同一对象已处理。 */
@Mapper
public interface AutomationRunMapper {

    int insertIgnore(@Param("workspaceId") String workspaceId,
                     @Param("ruleKey") String ruleKey,
                     @Param("targetKey") String targetKey,
                     @Param("runDate") LocalDate runDate,
                     @Param("status") String status,
                     @Param("message") String message);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    /** 撤回本次占位：投递失败时调用，让下一个整点重试。 */
    int deleteClaim(@Param("workspaceId") String workspaceId,
                    @Param("ruleKey") String ruleKey,
                    @Param("targetKey") String targetKey,
                    @Param("runDate") LocalDate runDate);
}
