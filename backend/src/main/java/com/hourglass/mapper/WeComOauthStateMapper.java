package com.hourglass.mapper;

import com.hourglass.entity.WeComOauthState;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;

@Mapper
public interface WeComOauthStateMapper {

    int insert(WeComOauthState row);

    /** 原子消费：只有未消费且未过期才成功，返回受影响行数 */
    int consume(@Param("state") String state);

    WeComOauthState selectByState(String state);

    int deleteExpired(@Param("before") LocalDateTime before);
}