package com.hourglass.mapper;

import com.hourglass.entity.WeComMsgLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface WeComMsgLogMapper {

    int insert(WeComMsgLog log);

    WeComMsgLog selectById(String id);

    int updateResult(WeComMsgLog log);

    List<WeComMsgLog> selectRecent(@Param("workspaceId") String workspaceId,
                                   @Param("corpId") String corpId,
                                   @Param("limit") int limit);

    List<WeComMsgLog> selectRetryDue(@Param("now") LocalDateTime now, @Param("limit") int limit);

    int deleteOlderThan(@Param("before") LocalDateTime before);
}