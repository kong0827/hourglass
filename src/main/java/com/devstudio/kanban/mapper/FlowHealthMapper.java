package com.devstudio.kanban.mapper;

import com.devstudio.kanban.dto.FlowMoveRow;
import com.devstudio.kanban.dto.FlowReqDocRow;
import com.devstudio.kanban.dto.FlowTaskRow;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 流程体检的数据读取。三次查询搞定，聚合全在 Service 内存里做
 * （按时间线切段，用 SQL 硬算既难读也很难改口径）。
 */
@Mapper
public interface FlowHealthMapper {

    /** 时间窗内的移动事件（列内排序也返回，由 Service 过滤：from==to 的没有流程含义） */
    List<FlowMoveRow> selectMoves(@Param("workspaceId") String workspaceId,
                                  @Param("since") LocalDateTime since);

    /** 空间内全部未删除任务（不过滤时间：老任务也可能在窗内被拖来拖去） */
    List<FlowTaskRow> selectTasks(@Param("workspaceId") String workspaceId);

    /** 需求 + 首个关联任务创建时间 */
    List<FlowReqDocRow> selectReqDocs(@Param("workspaceId") String workspaceId);
}
