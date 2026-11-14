package com.hourglass.mapper;

import com.hourglass.entity.DocCategory;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface DocCategoryMapper {

    /** 某范围（项目或空间级）下的全部分类节点，服务层排层级与 DFS 顺序 */
    List<DocCategory> selectByScope(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    /** 空间下全部分类（前端一次取回后按 reqId 分组到项目 / 空间两棵树） */
    List<DocCategory> selectByWorkspace(@Param("workspaceId") String workspaceId);

    DocCategory selectById(@Param("id") String id);

    int insert(DocCategory category);

    int update(DocCategory category);

    int delete(@Param("workspaceId") String workspaceId, @Param("id") String id);

    int countChildren(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId,
                      @Param("parentId") String parentId);

    /** 直接挂在该分类下的文档数（删除前拦截用） */
    int countDocs(@Param("workspaceId") String workspaceId, @Param("categoryId") String categoryId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteAllByWorkspace(@Param("workspaceId") String workspaceId);
}