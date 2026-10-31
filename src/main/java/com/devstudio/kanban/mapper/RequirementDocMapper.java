package com.devstudio.kanban.mapper;

import com.devstudio.kanban.dto.ReqDocView;
import com.devstudio.kanban.entity.RequirementDoc;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface RequirementDocMapper {

    /** 空间下的需求列表（带项目名、关联任务数、正文片段） */
    List<ReqDocView> selectViewByWorkspace(@Param("workspaceId") String workspaceId);

    RequirementDoc selectById(@Param("id") String id);

    int insert(RequirementDoc doc);

    int update(RequirementDoc doc);

    int delete(@Param("id") String id);

    /** 某项目下的需求数（删除项目前拦一下） */
    int countByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 项目列表一次性取各项目的需求数，避免逐项目 COUNT */
    java.util.List<java.util.Map<String, Object>> countGroupByReq(@Param("workspaceId") String workspaceId);

    /** 需求删除时，把关联到它的任务解绑（任务本身保留） */
    int clearTaskRef(@Param("workspaceId") String workspaceId, @Param("reqDocId") String reqDocId);

    /** 需求换项目：只解绑仍挂在其它项目下的任务引用 */
    int clearTaskRefExceptReq(@Param("workspaceId") String workspaceId,
                              @Param("reqDocId") String reqDocId,
                              @Param("reqId") String reqId);

    /** 项目删除时，连带清掉它下面的所有需求（返回被清掉的需求 ID，便于再清任务引用） */
    List<String> selectIdsByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 删除空间时清空该空间的全部需求文档（含正文） */
    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);

    /** 备份导出：读取全部需求（含正文） */
    List<RequirementDoc> selectAllByWorkspace(@Param("workspaceId") String workspaceId);
}
