package com.hourglass.mapper;

import com.hourglass.entity.InviteProjectGrant;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface InviteProjectGrantMapper {

    int insert(InviteProjectGrant grant);

    List<InviteProjectGrant> selectByInvite(@Param("inviteId") String inviteId);

    int deleteByInvite(@Param("inviteId") String inviteId);

    /** 项目删除时清掉所有邀请上对它的预分配，避免残留授权指向已删除项目 */
    int deleteByProject(@Param("workspaceId") String workspaceId, @Param("projectId") String projectId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
