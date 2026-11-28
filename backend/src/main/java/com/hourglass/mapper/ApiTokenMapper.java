package com.hourglass.mapper;

import com.hourglass.entity.ApiToken;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface ApiTokenMapper {

    int insert(ApiToken token);

    ApiToken selectById(@Param("id") String id);

    ApiToken selectByHash(@Param("hash") String hash);

    List<ApiToken> selectByUser(@Param("userId") String userId);

    /** 管理员排查看全部令牌，可按账号过滤（userId 为空则全部） */
    List<ApiToken> selectAll(@Param("userId") String userId);

    int touchLastUsed(@Param("id") String id, @Param("at") LocalDateTime at);

    /** 只撤销仍有效的令牌；已撤销时返回 0，调用方按幂等处理 */
    int revoke(@Param("id") String id, @Param("userId") String userId, @Param("at") LocalDateTime at);

    /** 管理员强制撤销任意令牌（不校验归属，用于处置泄漏） */
    int revokeAny(@Param("id") String id, @Param("at") LocalDateTime at);
}