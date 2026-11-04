package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.UserListPreference;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface UserListPreferenceMapper {

    UserListPreference select(@Param("userId") String userId,
                              @Param("workspaceId") String workspaceId,
                              @Param("viewKey") String viewKey);

    int upsert(UserListPreference preference);
}
