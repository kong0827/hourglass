package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.AppUser;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface UserMapper {

    List<AppUser> selectAll();

    AppUser selectById(String id);

    AppUser selectByUsername(String username);

    int countAll();

    /**
     * 锁定当前全部管理员行（SELECT ... FOR UPDATE，须在事务内调用）。
     * 降权/删除管理员前先调用再按返回数量校验，串行化"至少保留一名管理员"约束。
     */
    List<String> lockAdmins();

    int insert(AppUser user);

    int update(AppUser user);

    int updatePassword(@Param("id") String id, @Param("passwordHash") String passwordHash);

    int updateLastWorkspace(@Param("id") String id, @Param("workspaceId") String workspaceId);

    /** 只改计时设置（工作时段 + 每天上限），不动显示名/角色 */
    int updateWorkHours(@Param("id") String id, @Param("startHour") int startHour,
                        @Param("endHour") int endHour, @Param("maxHours") int maxHours);

    /** 只改 AI 配置（apiKey 传 null 表示保持原值，由 Service 决定） */
    int updateAiConfig(@Param("id") String id, @Param("provider") String provider,
                       @Param("baseUrl") String baseUrl, @Param("model") String model,
                       @Param("apiKey") String apiKey, @Param("enabled") boolean enabled);

    int deleteById(String id);
}
