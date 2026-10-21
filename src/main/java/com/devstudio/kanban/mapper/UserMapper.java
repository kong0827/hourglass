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

    int deleteById(String id);
}
