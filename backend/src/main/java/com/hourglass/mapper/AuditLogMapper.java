package com.hourglass.mapper;

import com.hourglass.entity.AuditLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface AuditLogMapper {

    int insert(AuditLog log);

    int count(@Param("workspaceId") String workspaceId,
              @Param("q") String q,
              @Param("action") String action,
              @Param("result") String result,
              @Param("actorId") String actorId,
              @Param("from") LocalDateTime from,
              @Param("to") LocalDateTime to);

    List<AuditLog> selectPage(@Param("workspaceId") String workspaceId,
                              @Param("q") String q,
                              @Param("action") String action,
                              @Param("result") String result,
                              @Param("actorId") String actorId,
                              @Param("from") LocalDateTime from,
                              @Param("to") LocalDateTime to,
                              @Param("offset") int offset,
                              @Param("size") int size);

    List<AuditLog> selectForExport(@Param("workspaceId") String workspaceId,
                                   @Param("q") String q,
                                   @Param("action") String action,
                                   @Param("result") String result,
                                   @Param("actorId") String actorId,
                                   @Param("from") LocalDateTime from,
                                   @Param("to") LocalDateTime to,
                                   @Param("limit") int limit);

    LocalDateTime selectOldest(@Param("workspaceId") String workspaceId);

    int deleteBefore(@Param("cutoff") LocalDateTime cutoff);
}
