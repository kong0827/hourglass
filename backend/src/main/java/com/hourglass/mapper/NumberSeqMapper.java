package com.hourglass.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 人类可读编号的序列（sql/87）：取号只增不减，删除业务行不回收编号。
 * demand / case 按项目取，plan 按空间取（scope_id 为空串）。
 */
@Mapper
public interface NumberSeqMapper {

    /** 序列自增；行锁保留到事务结束，因此必须与紧随其后的读取在同一事务里 */
    int bump(@Param("workspaceId") String workspaceId,
             @Param("kind") String kind,
             @Param("scopeId") String scopeId);

    Integer selectNext(@Param("workspaceId") String workspaceId,
                       @Param("kind") String kind,
                       @Param("scopeId") String scopeId);

    /** 备份恢复后把序列抬到已导入编号之上，避免下一次取号撞唯一键 */
    int raiseTo(@Param("workspaceId") String workspaceId,
                @Param("kind") String kind,
                @Param("scopeId") String scopeId,
                @Param("nextNo") int nextNo);

    /** 删除空间：序列随空间一起清，避免遗留孤立行 */
    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
