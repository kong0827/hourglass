package com.hourglass.mapper;

import com.hourglass.entity.VersionCommitmentTask;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface VersionCommitmentMapper {

    List<VersionCommitmentTask> selectByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    List<VersionCommitmentTask> selectByWorkspace(@Param("workspaceId") String workspaceId);

    int insertBatch(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId,
                    @Param("tasks") List<VersionCommitmentTask> tasks);

    int deleteByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
