package com.hourglass.mapper;

import com.hourglass.entity.WorkspaceMember;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface WorkspaceMemberMapper {

    List<WorkspaceMember> selectByWorkspace(@Param("workspaceId") String workspaceId);

    /** 备份导入：一次取回成员 user_id 集合，替代逐个 selectMember */
    List<String> selectUserIds(@Param("workspaceId") String workspaceId);

    WorkspaceMember selectMember(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    /** Current delivery permission snapshot; caller must hold project/task scope locks first. */
    Map<String, Object> selectDeliveryAccessForUpdate(@Param("workspaceId") String workspaceId,
                                                    @Param("userId") String userId,
                                                    @Param("projectId") String projectId);

    int insert(WorkspaceMember member);

    int updateRole(@Param("workspaceId") String workspaceId, @Param("userId") String userId,
                   @Param("role") String role);

    int updateProjectAccessMode(@Param("workspaceId") String workspaceId,
                                @Param("userId") String userId, @Param("mode") String mode);

    int updateCompanyName(@Param("workspaceId") String workspaceId,
                          @Param("userId") String userId,
                          @Param("companyName") String companyName);

    int delete(@Param("workspaceId") String workspaceId, @Param("userId") String userId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    int deleteAllByUser(@Param("userId") String userId);
}
