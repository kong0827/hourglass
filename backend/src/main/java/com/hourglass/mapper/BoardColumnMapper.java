package com.hourglass.mapper;

import com.hourglass.entity.BoardColumn;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface BoardColumnMapper {

    List<BoardColumn> selectAll(@Param("workspaceId") String workspaceId);

    BoardColumn selectById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int insert(BoardColumn column);

    int update(BoardColumn column);

    int deleteById(@Param("workspaceId") String workspaceId, @Param("id") String id);

    Integer maxSortOrder(@Param("workspaceId") String workspaceId);

    int updateSortOrder(@Param("workspaceId") String workspaceId, @Param("id") String id,
                        @Param("sortOrder") int sortOrder);

    int moveTasks(@Param("workspaceId") String workspaceId, @Param("source") String source,
                  @Param("target") String target);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
