package com.hourglass.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** 助手用量日聚合：只累加计数与 token，不落问题与回答正文 */
@Mapper
public interface AiUsageMapper {

    @Insert("INSERT INTO ai_usage_daily "
            + "(workspace_id, day, intent, calls, failures, prompt_tokens, completion_tokens, total_ms) "
            + "VALUES (#{workspaceId}, #{day}, #{intent}, 1, #{failures}, #{promptTokens}, #{completionTokens}, #{totalMs}) "
            + "ON DUPLICATE KEY UPDATE calls = calls + 1, failures = failures + #{failures}, "
            + "prompt_tokens = prompt_tokens + #{promptTokens}, "
            + "completion_tokens = completion_tokens + #{completionTokens}, "
            + "total_ms = total_ms + #{totalMs}")
    int record(@Param("workspaceId") String workspaceId,
               @Param("day") LocalDate day,
               @Param("intent") String intent,
               @Param("failures") int failures,
               @Param("promptTokens") int promptTokens,
               @Param("completionTokens") int completionTokens,
               @Param("totalMs") long totalMs);

    /** 按天汇总；day 从 from 开始（含） */
    @Select("SELECT day, SUM(calls) AS calls, SUM(failures) AS failures, "
            + "SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens, "
            + "SUM(total_ms) AS total_ms "
            + "FROM ai_usage_daily WHERE workspace_id = #{workspaceId} AND day >= #{from} "
            + "GROUP BY day ORDER BY day")
    List<Map<String, Object>> daily(@Param("workspaceId") String workspaceId,
                                    @Param("from") LocalDate from);

    /** 高频回答类型；失败不计入排序噪音 */
    @Select("SELECT intent, SUM(calls) AS calls, SUM(failures) AS failures, "
            + "SUM(prompt_tokens) + SUM(completion_tokens) AS tokens "
            + "FROM ai_usage_daily WHERE workspace_id = #{workspaceId} AND day >= #{from} "
            + "GROUP BY intent ORDER BY calls DESC LIMIT #{limit}")
    List<Map<String, Object>> topIntents(@Param("workspaceId") String workspaceId,
                                         @Param("from") LocalDate from,
                                         @Param("limit") int limit);
}
