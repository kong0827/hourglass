package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.UserNotificationPreference;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface UserNotificationPreferenceMapper {

    List<UserNotificationPreference> selectByUser(@Param("userId") String userId);

    UserNotificationPreference selectOne(@Param("userId") String userId,
                                         @Param("eventType") String eventType);

    int upsert(UserNotificationPreference preference);
}
