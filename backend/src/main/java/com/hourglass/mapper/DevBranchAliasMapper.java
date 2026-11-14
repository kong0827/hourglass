package com.hourglass.mapper;

import com.hourglass.entity.DevBranchAlias;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface DevBranchAliasMapper {

    int insert(DevBranchAlias alias);

    List<DevBranchAlias> selectByBranch(@Param("workspaceId") String workspaceId,
                                        @Param("branchId") String branchId);

    List<DevBranchAlias> selectByRepo(@Param("workspaceId") String workspaceId,
                                      @Param("repoId") String repoId);

    int deleteByBranch(@Param("workspaceId") String workspaceId, @Param("branchId") String branchId);

    int deleteByRepo(@Param("workspaceId") String workspaceId, @Param("repoId") String repoId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
