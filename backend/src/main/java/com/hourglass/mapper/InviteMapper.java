package com.hourglass.mapper;

import com.hourglass.entity.Invite;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface InviteMapper {

    int insert(Invite invite);

    Invite selectById(String id);

    List<Invite> selectByWorkspace(@Param("workspaceId") String workspaceId);

    int incrUsedCount(@Param("id") String id);

    int delete(@Param("id") String id);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
