package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.Attachment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface AttachmentMapper {

    List<Attachment> selectByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    List<Attachment> selectAllByWorkspace(@Param("workspaceId") String workspaceId);

    Attachment selectById(String id);

    int insert(Attachment attachment);

    int deleteById(String id);

    int deleteByTaskId(@Param("workspaceId") String workspaceId, @Param("taskId") String taskId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
