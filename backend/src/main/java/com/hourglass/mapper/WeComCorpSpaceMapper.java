package com.hourglass.mapper;

import com.hourglass.entity.WeComCorpSpace;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WeComCorpSpaceMapper {

    List<String> selectCorpIdsByWorkspace(String workspaceId);

    List<WeComCorpSpace> selectByWorkspace(String workspaceId);

    int insert(WeComCorpSpace row);

    int delete(@Param("workspaceId") String workspaceId, @Param("corpId") String corpId);

    int deleteByWorkspace(String workspaceId);

    int deleteByCorp(String corpId);
}