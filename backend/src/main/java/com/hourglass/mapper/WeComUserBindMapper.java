package com.hourglass.mapper;

import com.hourglass.entity.WeComUserBind;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface WeComUserBindMapper {

    WeComUserBind selectByCorpUserid(@Param("corpId") String corpId,
                                     @Param("wecomUserid") String wecomUserid);

    WeComUserBind selectById(String id);

    WeComUserBind selectByUserAndCorp(@Param("userId") String userId,
                                      @Param("corpId") String corpId);

    List<WeComUserBind> selectByUser(String userId);

    List<WeComUserBind> selectByCorp(String corpId);

    int insert(WeComUserBind bind);

    int updateStatus(@Param("id") String id, @Param("status") String status,
                     @Param("boundBy") String boundBy);

    int updateLastLogin(@Param("id") String id, @Param("lastLoginAt") LocalDateTime lastLoginAt);

    int deleteById(String id);

    int countByCorp(String corpId);
}