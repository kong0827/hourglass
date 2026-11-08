package com.hourglass.mapper;

import com.hourglass.entity.TestModule;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface TestModuleMapper {

    List<String> selectNames(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int insert(TestModule module);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);
}
