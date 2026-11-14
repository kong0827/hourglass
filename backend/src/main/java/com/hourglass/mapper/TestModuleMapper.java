package com.hourglass.mapper;

import com.hourglass.entity.TestModule;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TestModuleMapper {

    List<String> selectNames(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 目录树：项目下全部节点（服务层排层级与 DFS 顺序） */
    List<TestModule> selectByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    TestModule selectById(@Param("id") String id);

    /** 按名称找节点（自由文本 / CSV 导入归类用）：同名取排序最前的一个 */
    TestModule selectByName(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                            @Param("name") String name);

    int insert(TestModule module);

    int update(TestModule module);

    int delete(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int countChildren(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                      @Param("parentId") String parentId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
}