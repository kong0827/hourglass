package com.hourglass.mapper;

import com.hourglass.entity.WorkspaceAutomation;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WorkspaceAutomationMapper {

    List<WorkspaceAutomation> selectByWorkspace(@Param("workspaceId") String workspaceId);

    WorkspaceAutomation selectOne(@Param("workspaceId") String workspaceId,
                                  @Param("ruleKey") String ruleKey);

    int upsert(WorkspaceAutomation rule);

    int touchRun(@Param("workspaceId") String workspaceId,
                 @Param("ruleKey") String ruleKey,
                 @Param("status") String status);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
