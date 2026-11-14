package com.hourglass.mapper;

import com.hourglass.entity.DocTemplate;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface DocTemplateMapper {

    int insert(DocTemplate template);

    DocTemplate selectById(@Param("id") String id);

    DocTemplate selectByName(@Param("workspaceId") String workspaceId, @Param("name") String name);

    List<DocTemplate> selectByWorkspace(@Param("workspaceId") String workspaceId);

    int delete(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
