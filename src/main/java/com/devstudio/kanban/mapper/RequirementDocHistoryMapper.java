package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.RequirementDocHistory;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface RequirementDocHistoryMapper {

    int insert(RequirementDocHistory history);

    /** 版本列表（不含正文，避免把多版大正文一次拉出来） */
    List<RequirementDocHistory> selectByDoc(@Param("workspaceId") String workspaceId,
                                            @Param("docId") String docId);

    /** 单个版本（含正文） */
    RequirementDocHistory selectById(@Param("id") String id);

    /** 当前最大版本号（无历史时为 0） */
    int maxVersionNo(@Param("docId") String docId);

    /** 只保留最近 keep 版（按 version_no 倒序截断） */
    int deleteOld(@Param("docId") String docId, @Param("keep") int keep);

    int deleteByDoc(@Param("workspaceId") String workspaceId, @Param("docId") String docId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}
