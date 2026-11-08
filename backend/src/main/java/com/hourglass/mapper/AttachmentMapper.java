package com.hourglass.mapper;

import com.hourglass.entity.Attachment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface AttachmentMapper {

    /** 按目标取附件（target_kind：task / demand / case_run） */
    List<Attachment> selectByTarget(@Param("workspaceId") String workspaceId,
                                    @Param("targetId") String targetId, @Param("targetKind") String targetKind);

    /** 批量取附件（执行记录列表一次取全部证据，避免 N+1） */
    List<Attachment> selectByTargets(@Param("workspaceId") String workspaceId,
                                     @Param("targetKind") String targetKind,
                                     @Param("targetIds") List<String> targetIds);

    /** 用例/项目删除后遗留的执行证据（执行记录已不存在） */
    List<Attachment> selectOrphanCaseRuns(@Param("workspaceId") String workspaceId);

    int deleteOrphanCaseRuns(@Param("workspaceId") String workspaceId);

    List<Attachment> selectAllByWorkspace(@Param("workspaceId") String workspaceId);

    /** 按任务 id 批量取附件（拼搜索字段用，避免整空间加载） */
    List<Attachment> selectByTaskIds(@Param("workspaceId") String workspaceId,
                                     @Param("taskIds") List<String> taskIds);

    Attachment selectById(String id);

    int insert(Attachment attachment);

    int updateContent(Attachment attachment);

    int deleteById(String id);

    int deleteByTaskIds(@Param("workspaceId") String workspaceId, @Param("taskIds") List<String> taskIds);

    /** 任务评论上的附件（target_id = task_comment.id） */
    List<Attachment> selectByCommentTaskIds(@Param("workspaceId") String workspaceId,
                                            @Param("taskIds") List<String> taskIds);

    int deleteByCommentTaskIds(@Param("workspaceId") String workspaceId,
                               @Param("taskIds") List<String> taskIds);

    int deleteByTarget(@Param("workspaceId") String workspaceId,
                       @Param("targetId") String targetId, @Param("targetKind") String targetKind);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
