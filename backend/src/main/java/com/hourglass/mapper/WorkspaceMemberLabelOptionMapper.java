package com.hourglass.mapper;

import org.apache.ibatis.annotations.*;
import java.util.List;

@Mapper
public interface WorkspaceMemberLabelOptionMapper {
    /** 串行化本空间字典替换及角色读改写；不修改空间配置或权限。 */
    @Select("SELECT id FROM workspace WHERE id = #{workspaceId} FOR UPDATE")
    String lockWorkspace(@Param("workspaceId") String workspaceId);

    @Select("SELECT title FROM workspace_member_label_option WHERE workspace_id = #{workspaceId} "
            + "AND kind = #{kind} ORDER BY sort_order, title")
    List<String> selectTitles(@Param("workspaceId") String workspaceId, @Param("kind") String kind);

    @Insert("INSERT INTO workspace_member_label_option (workspace_id, kind, title, sort_order) "
            + "VALUES (#{workspaceId}, #{kind}, #{title}, #{sortOrder})")
    int insert(@Param("workspaceId") String workspaceId, @Param("kind") String kind,
               @Param("title") String title, @Param("sortOrder") int sortOrder);

    @Delete("DELETE FROM workspace_member_label_option WHERE workspace_id = #{workspaceId}")
    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
