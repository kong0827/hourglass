package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.ReqDocShare;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ReqDocShareMapper {

    ReqDocShare selectByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    ReqDocShare selectByToken(@Param("token") String token);

    int upsert(ReqDocShare share);

    int deleteByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
