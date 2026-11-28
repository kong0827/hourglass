package com.hourglass.mapper;

import com.hourglass.entity.WeComGroupRobot;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface WeComGroupRobotMapper {

    List<WeComGroupRobot> selectByWorkspace(String workspaceId);

    List<WeComGroupRobot> selectActiveByWorkspace(String workspaceId);

    WeComGroupRobot selectById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int countByCorp(@Param("workspaceId") String workspaceId, @Param("corpId") String corpId);

    int countByCorpId(@Param("corpId") String corpId);

    int countByName(@Param("workspaceId") String workspaceId,
                    @Param("corpId") String corpId,
                    @Param("name") String name,
                    @Param("excludeId") String excludeId);

    int insert(WeComGroupRobot robot);

    int update(WeComGroupRobot robot);

    int updateStatus(@Param("workspaceId") String workspaceId,
                     @Param("id") String id,
                     @Param("status") String status);

    int updateResult(@Param("id") String id,
                     @Param("lastSentAt") LocalDateTime lastSentAt,
                     @Param("lastResult") String lastResult);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteByWorkspaceCorp(@Param("workspaceId") String workspaceId, @Param("corpId") String corpId);
}