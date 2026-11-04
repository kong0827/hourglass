package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.Attachment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface AttachmentMapper {

    /** 按目标取附件（target_kind：task / demand） */
    List<Attachment> selectByTarget(@Param("workspaceId") String workspaceId,
                                    @Param("targetId") String targetId, @Param("targetKind") String targetKind);

    List<Attachment> selectAllByWorkspace(@Param("workspaceId") String workspaceId);

    /** 按任务 id 批量取附件（拼搜索字段用，避免整空间加载） */
    List<Attachment> selectByTaskIds(@Param("workspaceId") String workspaceId,
                                     @Param("taskIds") List<String> taskIds);

    Attachment selectById(String id);

    int insert(Attachment attachment);

    int updateContent(Attachment attachment);

    int deleteById(String id);

    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
