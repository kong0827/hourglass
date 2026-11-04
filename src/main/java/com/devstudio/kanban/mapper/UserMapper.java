package com.devstudio.kanban.mapper;

import com.devstudio.kanban.dto.MemberCandidate;
import com.devstudio.kanban.entity.AppUser;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface UserMapper {

    List<AppUser> selectAll();

    /** 按登录名/显示名模糊搜索尚未加入该空间的账号（添加成员用，最多 20 条） */
    List<MemberCandidate> searchCandidates(@Param("workspaceId") String workspaceId,
                                           @Param("q") String q,
                                           @Param("limit") int limit);

    AppUser selectById(String id);

    /** 批量按 ID 查账号（通知里解析成员显示名用，避免逐个 selectById） */
    List<AppUser> selectByIds(@Param("ids") List<String> ids);

    AppUser selectByUsername(String username);

    /** 按邮箱查账号（登录回退用；写入口有唯一校验，历史脏数据取最早一条） */
    AppUser selectByEmail(@Param("email") String email);

    /** 邮箱占用计数（excludeId 非空表示编辑时排除自己）；登录按邮箱取人，必须保证不重复 */
    int countByEmail(@Param("email") String email, @Param("excludeId") String excludeId);

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

    /** 删除共享空间后清空停留位置，下次访问由 WorkspaceService 解析回各自个人空间 */
    int resetLastWorkspaceForAll(@Param("workspaceId") String workspaceId);

    /** 只改计时设置（工作时段 + 每天上限），不动显示名/角色 */
    int updateWorkHours(@Param("id") String id, @Param("startHour") int startHour,
                        @Param("endHour") int endHour, @Param("maxHours") int maxHours);

    /** 只改 AI 配置（apiKey 传 null 表示保持原值，由 Service 决定） */
    int updateAiConfig(@Param("id") String id, @Param("provider") String provider,
                       @Param("baseUrl") String baseUrl, @Param("model") String model,
                       @Param("apiKey") String apiKey, @Param("enabled") boolean enabled);

    int deleteById(String id);
}
