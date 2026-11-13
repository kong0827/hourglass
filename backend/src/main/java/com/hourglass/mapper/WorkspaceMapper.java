package com.hourglass.mapper;

import com.hourglass.entity.Workspace;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WorkspaceMapper {

    /** 当前用户参与的空间（含我的角色与成员数；个人空间排前） */
    List<Workspace> selectByUser(@Param("userId") String userId);

    /** 全量空间（启动兜底补齐配置用） */
    List<Workspace> selectAll();

    Workspace selectById(String id);

    int insert(Workspace workspace);

    int update(Workspace workspace);

    /** 回写最近一次推送尝试结果（设置页「是否真正生效」的依据） */
    int updateNotifyResult(@Param("id") String id, @Param("status") String status);

    int deleteById(String id);

    /** 该账号是唯一空间主的共享空间数量（删账号前校验，其他空间主不受影响） */
    int countSharedWithSoleOwner(@Param("userId") String userId);
}
