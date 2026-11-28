package com.hourglass.mapper;

import com.hourglass.entity.ReleasePlanShare;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ReleasePlanShareMapper {

    ReleasePlanShare selectByPlan(@Param("workspaceId") String workspaceId, @Param("planId") String planId);

    ReleasePlanShare selectByToken(@Param("token") String token);

    int upsert(ReleasePlanShare share);

    int revoke(@Param("workspaceId") String workspaceId, @Param("planId") String planId);
}
